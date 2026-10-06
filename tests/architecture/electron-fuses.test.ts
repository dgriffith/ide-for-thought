/**
 * @vitest-environment node
 *
 * The packaged app's Electron fuses are a decision, pinned (#2366).
 *
 * `forge.config.ts` had no FusesPlugin, so every security-relevant fuse sat at
 * Electron's permissive default and nothing recorded that anyone had looked.
 * Fuses fail silently in both directions — a door left open produces no error,
 * and a door shut that something needed (RunAsNode, which IS the `minerva`
 * CLI) only fails for the user who runs that thing — so the values live in
 * one policy file and this test holds them:
 *
 *  - every value in `scripts/lib/electron-fuses.mjs`, written out again here
 *    so a change to either is a change to both, on purpose;
 *  - forge.config.ts actually feeds that policy to the FusesPlugin, and packs
 *    an asar (both asar fuses are meaningless — or fatal — without one);
 *  - the read-back script's comparison logic;
 *  - ci.yml and release.yml run the read-back against the BUILT app, since a
 *    config that asks for a fuse proves nothing about the binary.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { FuseV1Options } from '@electron/fuses';
import { FUSE_POLICY, forgeFuseSettings, checkFuseWire } from '../../scripts/lib/electron-fuses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The decision table. Reasons live beside each entry in the policy file.
const EXPECTED: Record<string, boolean> = {
  RunAsNode: false, // the CLI runs in CLI mode, not as plain Node (#2565)
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: false, // renderer is app:// (#2564) — see policy
  WasmTrapHandlers: true,
};

const ENABLE = 49;
const DISABLE = 48;
function wireFromPolicy(): Record<string, unknown> {
  return {
    version: '1',
    ...Object.fromEntries(FUSE_POLICY.map((f) => [f.index, f.enabled ? ENABLE : DISABLE])),
  };
}

describe('Electron fuse policy (#2366)', () => {
  it('pins every fuse to its decided value', () => {
    expect(Object.fromEntries(FUSE_POLICY.map((f) => [f.name, f.enabled]))).toEqual(EXPECTED);
  });

  it('covers a contiguous wire with unique names — no gap for a fuse to hide in', () => {
    const indices = FUSE_POLICY.map((f) => f.index);
    expect(indices).toEqual(indices.map((_, i) => i));
    expect(new Set(FUSE_POLICY.map((f) => f.name)).size).toBe(FUSE_POLICY.length);
  });

  it("uses @electron/fuses' wire index for every fuse that library names", () => {
    for (const f of FUSE_POLICY) {
      const known = (FuseV1Options as unknown as Record<string, number | undefined>)[f.name];
      if (known !== undefined) expect(f.index, f.name).toBe(known);
    }
  });

  it('RunAsNode stays off, and the CLI shim never relies on it (#2565)', () => {
    // The shim runs the binary in CLI mode (cli-mode.ts). A shim that set
    // ELECTRON_RUN_AS_NODE again would silently do nothing with the fuse off —
    // and turning the fuse back on to "fix" it reopens arbitrary JS as Minerva.
    const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'cli-install.ts'), 'utf-8');
    expect(src).not.toMatch(/ELECTRON_RUN_AS_NODE=1/);
    expect(src).toMatch(/CLI_MODE_FLAG/);
    expect(FUSE_POLICY.find((f) => f.name === 'RunAsNode')?.enabled).toBe(false);
  });

  it('the entitlements never re-enable loading unsigned libraries (#2565)', () => {
    const plist = fs.readFileSync(path.join(ROOT, 'build', 'entitlements.mac.plist'), 'utf-8');
    expect(plist).not.toMatch(/<key>com\.apple\.security\.cs\.disable-library-validation<\/key>/);
  });
});

describe('forge.config.ts applies the policy', () => {
  it('passes the policy to FusesPlugin and packs an asar with native code unpacked', async () => {
    const { default: config } = await import('../../forge.config');
    const fuses = (config.plugins ?? []).find(
      (p): p is typeof p & { fusesConfig: Record<string, unknown> } =>
        typeof p === 'object' && p !== null && (p as { name?: string }).name === 'fuses',
    );
    expect(fuses, 'forge.config.ts has no FusesPlugin').toBeDefined();
    expect(fuses!.fusesConfig).toEqual({
      version: '1',
      strictlyRequireAllFuses: true,
      ...forgeFuseSettings(),
    });

    // OnlyLoadAppFromAsar with no asar is an app that cannot start; integrity
    // validation with no asar validates nothing.
    const asar = config.packagerConfig?.asar;
    expect(asar, 'packagerConfig.asar must be set for the asar fuses').toBeTruthy();
    expect(typeof asar === 'object' ? asar.unpack : '').toMatch(/\.?\{?node/);
  });
});

describe('checkFuseWire (the read-back comparison)', () => {
  it('accepts a wire that matches the policy', () => {
    expect(checkFuseWire(wireFromPolicy())).toMatchObject({ ok: true, errors: [] });
  });

  it('rejects a fuse at the wrong value', () => {
    const wire = { ...wireFromPolicy(), [FuseV1Options.EnableNodeCliInspectArguments]: ENABLE };
    const r = checkFuseWire(wire);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/EnableNodeCliInspectArguments is enabled/);
  });

  it('rejects a fuse the policy does not name (an Electron upgrade added one)', () => {
    const r = checkFuseWire({ ...wireFromPolicy(), [FUSE_POLICY.length]: ENABLE });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/does not name/);
  });

  it('rejects a wire shorter than the policy, and a wire of another version', () => {
    const short = wireFromPolicy();
    delete short[FUSE_POLICY.length - 1];
    expect(checkFuseWire(short).ok).toBe(false);
    expect(checkFuseWire({ ...wireFromPolicy(), version: '2' }).ok).toBe(false);
  });
});

interface Step { name?: string; run?: string }
interface Job { steps?: Step[] }
interface Workflow { jobs?: Record<string, Job> }

function stepsOf(file: string, job: string): Step[] {
  const wf = parse(fs.readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf-8')) as Workflow;
  return wf.jobs?.[job]?.steps ?? [];
}
const isFuseCheck = (s: Step) => /scripts\/check-electron-fuses\.mjs/.test(s.run ?? '');

describe('the built app is read back', () => {
  it("ci.yml's e2e job checks the fuses after packaging", () => {
    const steps = stepsOf('ci.yml', 'e2e');
    const build = steps.findIndex((s) => /pnpm test:e2e/.test(s.run ?? ''));
    const check = steps.findIndex(isFuseCheck);
    expect(build, 'ci.yml e2e no longer runs pnpm test:e2e').toBeGreaterThanOrEqual(0);
    expect(check, 'ci.yml e2e must run scripts/check-electron-fuses.mjs').toBeGreaterThan(build);
  });

  it('release.yml checks the signed build before smoke-booting it', () => {
    const steps = stepsOf('release.yml', 'build-macos');
    const build = steps.findIndex((s) => /^pnpm build\b/.test((s.run ?? '').trim()));
    const check = steps.findIndex(isFuseCheck);
    const smoke = steps.findIndex((s) => /smoke\.spec\.ts/.test(s.run ?? ''));
    expect(build).toBeGreaterThanOrEqual(0);
    expect(check, 'release.yml must run scripts/check-electron-fuses.mjs after the build').toBeGreaterThan(build);
    expect(smoke).toBeGreaterThan(check);
  });
});
