/**
 * @vitest-environment node
 *
 * Signing and notarization are opted into by MINERVA_RELEASE, and only the
 * signed release build sets it.
 *
 * `forge.config.ts` used to sign whenever the App Store Connect key vars (or
 * OSX_SIGN_IDENTITY) were in the environment. The maintainer's shell exports
 * them, so every `pnpm build:e2e` / `pnpm package` / `pnpm build` on that
 * machine — agents' throwaway test builds included — signed and ran
 * `notarytool submit` under the maintainer's Apple Developer identity.
 *
 * The rule is `scripts/lib/signing-policy.mjs` (unit-tested in
 * `tests/scripts/signing-policy.test.ts`). This pins the wiring around it:
 *
 *  - forge.config.ts takes signing from the policy and reads no Apple env var
 *    itself, so there is no second, creds-only route back to signing;
 *  - release.yml's signed build step is the one CI step that sets the flag,
 *    guarded by the same HAS_SIGNING condition as the signature verification;
 *  - ci.yml and bench.yml never set it, and no package.json script except
 *    `build:release` does.
 *
 * The forge.config cases import the real config with FAKE env values for every
 * credential var — importing it builds a config object and signs nothing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLAG = 'MINERVA_RELEASE';
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

interface Step { name?: string; run?: string; if?: string; env?: Record<string, unknown> }
interface Job { env?: Record<string, unknown>; steps?: Step[] }
interface Workflow { env?: Record<string, unknown>; jobs?: Record<string, Job> }
const workflow = (file: string) => parse(read(`.github/workflows/${file}`)) as Workflow;

/** Does this step build with the release flag, directly or via the script? */
const setsFlag = (s: Step) =>
  /\bbuild:release\b/.test(s.run ?? '') ||
  new RegExp(`\\b${FLAG}\\b`).test(s.run ?? '') ||
  Object.keys(s.env ?? {}).includes(FLAG);

describe('package.json: only build:release sets the flag', () => {
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

  it('build:release sets it and runs forge make', () => {
    expect(scripts['build:release']).toMatch(new RegExp(`^${FLAG}=1 electron-forge make$`));
  });

  it('no other script sets it or chains into build:release', () => {
    const offenders = Object.entries(scripts)
      .filter(([name]) => name !== 'build:release')
      .filter(([, cmd]) => cmd.includes(FLAG) || /\bbuild:release\b/.test(cmd))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it.each(['build', 'build:e2e', 'package', 'dev', 'test:e2e'])('%s runs without the flag', (name) => {
    expect(scripts[name], `package.json has no "${name}" script`).toBeDefined();
    expect(scripts[name]).not.toContain(FLAG);
    expect(scripts[name]).not.toMatch(/\bbuild:release\b/);
  });
});

describe('ci.yml and bench.yml never sign', () => {
  it.each(['ci.yml', 'bench.yml'])('%s does not mention the flag or build:release', (file) => {
    const src = read(`.github/workflows/${file}`);
    expect(src).not.toContain(FLAG);
    expect(src).not.toMatch(/\bbuild:release\b/);
  });
});

describe('release.yml sets the flag on its signed build, and nowhere else', () => {
  const wf = workflow('release.yml');
  const job = wf.jobs?.['build-macos'];
  const steps = job?.steps ?? [];

  it('parses — an empty scan would pass vacuously', () => {
    expect(steps.length).toBeGreaterThan(10);
  });

  it('not at workflow or job scope, and never exported through $GITHUB_ENV', () => {
    expect(Object.keys(wf.env ?? {})).not.toContain(FLAG);
    expect(Object.keys(job?.env ?? {})).not.toContain(FLAG);
    for (const s of steps) {
      const run = s.run ?? '';
      if (run.includes('GITHUB_ENV')) expect(run, `step "${s.name}" exports ${FLAG}`).not.toContain(FLAG);
    }
  });

  it('exactly one step builds with the flag, gated on the signing secrets', () => {
    const signed = steps.filter(setsFlag);
    expect(signed.map((s) => s.name)).toHaveLength(1);
    expect(signed[0]!.if).toMatch(/env\.HAS_SIGNING == 'true'/);
  });

  it('a secretless run still builds, unsigned, on the complementary condition', () => {
    const unsigned = steps.filter((s) => /^pnpm build\s*$/.test((s.run ?? '').trim()));
    expect(unsigned).toHaveLength(1);
    expect(unsigned[0]!.if).toMatch(/env\.HAS_SIGNING != 'true'/);
  });

  it('runs after the signing prep and before the signature verification', () => {
    const prep = steps.findIndex((s) => /Prepare macOS signing/.test(s.name ?? ''));
    const build = steps.findIndex(setsFlag);
    const verify = steps.findIndex((s) => /codesign --verify/.test(s.run ?? ''));
    expect(prep).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(prep);
    expect(verify).toBeGreaterThan(build);
    // The verification is gated identically, so a signed build is always checked.
    expect(steps[verify]!.if).toBe(steps[build]!.if);
  });

  it('no later step repackages (so none needs the flag)', () => {
    const lastBuild = Math.max(
      steps.findIndex(setsFlag),
      steps.findIndex((s) => /^pnpm build\s*$/.test((s.run ?? '').trim())),
    );
    const later = steps.slice(lastBuild + 1).filter((s) => /electron-forge|pnpm (build|package|make)\b/.test(s.run ?? ''));
    expect(later.map((s) => s.name)).toEqual([]);
  });
});

describe('forge.config.ts takes signing from the policy', () => {
  it('reads no Apple credential env var directly — the policy is the only route', () => {
    const src = read('forge.config.ts');
    expect(src).toContain("from './scripts/lib/signing-policy.mjs'");
    expect(src).not.toMatch(/process\.env\.(APPLE_API_KEY|APPLE_API_KEY_ID|APPLE_API_ISSUER|OSX_SIGN_IDENTITY|MINERVA_RELEASE)\b/);
  });

  // Every credential var is stubbed on every case, so the real shell's values
  // can never combine with the flag.
  const FAKE = {
    APPLE_API_KEY: '/tmp/fake/AuthKey_FAKE.p8',
    APPLE_API_KEY_ID: 'FAKEKEYID1',
    APPLE_API_ISSUER: '00000000-0000-0000-0000-000000000000',
    OSX_SIGN_IDENTITY: '',
  };
  const NONE = { APPLE_API_KEY: '', APPLE_API_KEY_ID: '', APPLE_API_ISSUER: '', OSX_SIGN_IDENTITY: '' };

  async function loadConfig(env: Record<string, string>) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { default: config } = await import('../../forge.config');
      return { config, logged: log.mock.calls.map((c) => String(c[0])) };
    } finally {
      log.mockRestore();
    }
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('credentials without the flag → unsigned, not notarized, and one line says so', async () => {
    const { config, logged } = await loadConfig({ ...FAKE, [FLAG]: '' });
    expect(config.packagerConfig?.osxSign).toBeUndefined();
    expect(config.packagerConfig?.osxNotarize).toBeUndefined();
    if (process.platform === 'darwin') {
      expect(logged.filter((l) => l.includes(FLAG))).toHaveLength(1);
    }
  });

  it('the flag without credentials → the config refuses to load', async () => {
    await expect(loadConfig({ ...NONE, [FLAG]: '1' })).rejects.toThrow(new RegExp(FLAG));
  });

  it.runIf(process.platform === 'darwin')('the flag with credentials → signs and notarizes', async () => {
    const { config } = await loadConfig({ ...FAKE, [FLAG]: '1' });
    expect(config.packagerConfig?.osxSign).toBeTruthy();
    expect(config.packagerConfig?.osxNotarize).toMatchObject({ appleApiKeyId: FAKE.APPLE_API_KEY_ID });
  });
});
