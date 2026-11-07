/**
 * The release-artifact size ratchet (#2243).
 *
 * The packaged app drifted to a 239 MB DMG and a 242 MB ZIP with nothing
 * watching. Every other large surface here has a committed number —
 * `file-size-budgets`, `pattern-ratchets`, the `vitest.config.mts` coverage
 * floors — and the one that users actually download had none.
 *
 * Testing the comparison rather than the filesystem: the interesting behaviour
 * is which way the gate fires and what it tolerates, and none of that needs a
 * 240 MB file on disk.
 */
import { describe, it, expect } from 'vitest';
import { compare, findArtifacts, formatMb, kindsFor } from '../../scripts/check-artifact-size.mjs';
import { posix } from '../helpers/posix-path';

const MB = 1024 * 1024;
const zip = (mb: number) => ({ zip: { file: 'a.zip', bytes: mb * MB } });
const both = (zipMb: number, dmgMb: number) => ({
  zip: { file: 'a.zip', bytes: zipMb * MB },
  dmg: { file: 'a.dmg', bytes: dmgMb * MB },
});

describe('growth fails the release', () => {
  it('flags an artifact over its budget', () => {
    const { grown } = compare(both(240, 200), { zip: 232 * MB, dmg: 232 * MB });
    expect(grown).toHaveLength(1);
    expect(grown[0]!.kind.key).toBe('zip');
    expect(grown[0]!.delta).toBe(8 * MB);
  });

  it('flags both when both grew', () => {
    const { grown } = compare(both(240, 240), { zip: 232 * MB, dmg: 232 * MB });
    expect(grown.map((g) => g.kind.key).sort()).toEqual(['dmg', 'zip']);
  });

  it('passes an artifact exactly at budget', () => {
    // A budget is a ceiling, not a target — equality is within it.
    const { grown, shrunk } = compare(both(232, 232), { zip: 232 * MB, dmg: 232 * MB });
    expect(grown).toEqual([]);
    expect(shrunk).toEqual([]);
  });
});

describe('compression noise does not fail the release', () => {
  it('tolerates a small shrink without demanding a re-bless', () => {
    // The budget carries ~2% headroom over what was measured, so the normal
    // case is an artifact a few MB under. Failing on that would train everyone
    // to re-bless without reading, which is how a ratchet dies.
    const { shrunk, grown } = compare(both(228, 228), { zip: 237 * MB, dmg: 236 * MB });
    expect(grown).toEqual([]);
    expect(shrunk).toEqual([]);
  });

  it('asks for the number to be lowered on a real win', () => {
    // This is not hypothetical: #2293's WASM prune took 20.8 MB off the ZIP and
    // this check is what caught it, refusing to pass until the number came
    // down. A win that size must be recorded, or it becomes headroom.
    const { shrunk } = compare(zip(170), { zip: 237 * MB });
    expect(shrunk).toHaveLength(1);
    expect(shrunk[0]!.kind.key).toBe('zip');
  });
});

describe('a missing artifact is a failure, not a pass', () => {
  it('reports the ZIP as missing rather than silently succeeding', () => {
    // The gate's worst failure mode: no ZIP means no auto-update payload, and
    // "nothing to measure" must never read as "within budget". release.yml
    // already fails on absence (#1639); this keeps that true if the size check
    // ever runs first.
    const { missing, grown } = compare({ dmg: { file: 'a.dmg', bytes: 100 * MB } }, { zip: 237 * MB, dmg: 236 * MB });
    expect(missing.map((m) => m.key)).toEqual(['zip']);
    expect(grown).toEqual([]);
  });

  it('skips a kind that has no budget yet instead of failing', () => {
    // First run after adding a new artifact kind: `--update` sets it.
    const { grown, shrunk } = compare(both(240, 240), {});
    expect(grown).toEqual([]);
    expect(shrunk).toEqual([]);
  });
});

describe('findArtifacts', () => {
  const tree: Record<string, string[]> = {
    '/make': ['Minerva-2.0.2-arm64.dmg', 'zip'],
    '/make/zip': ['darwin'],
    '/make/zip/darwin': ['arm64'],
    '/make/zip/darwin/arm64': ['Minerva-darwin-arm64-2.0.2.zip'],
  };
  // The script joins with the host's `path` (right for real paths); the fake
  // tree is keyed `/`-separated, so a Windows `\make\zip` is looked up the
  // same way (#2180).
  const readdirSync = (dir: string) =>
    (tree[posix(dir)] ?? []).map((name) => ({
      name,
      isDirectory: () => Boolean(tree[`${posix(dir)}/${name}`]),
    }));
  const statSync = () => ({ size: 5 * MB });

  it('finds the ZIP nested under zip/darwin/arch, where the maker puts it', () => {
    const found = findArtifacts('/make', { readdirSync, statSync });
    expect(found.zip?.file).toContain('Minerva-darwin-arm64-2.0.2.zip');
    expect(found.dmg?.file).toContain('Minerva-2.0.2-arm64.dmg');
  });
});

describe('each platform measures its own artifacts (#2182)', () => {
  it('Linux needs a .deb and an .rpm, not the macOS pair', () => {
    expect(kindsFor('linux').map((k) => k.ext)).toEqual(['.deb', '.rpm']);
    const { missing } = compare({ deb: { file: 'a.deb', bytes: 90 * MB } }, {}, 'linux');
    expect(missing.map((m) => m.key)).toEqual(['rpm']);
  });

  it('a Linux package with no budget yet is measured, not failed', () => {
    const r = compare({ deb: { file: 'a.deb', bytes: 90 * MB }, rpm: { file: 'a.rpm', bytes: 91 * MB } }, { zip: 1, dmg: 1 }, 'linux');
    expect(r).toEqual({ grown: [], shrunk: [], missing: [] });
  });

  it('a Linux package past its budget fails like a DMG', () => {
    const r = compare({ deb: { file: 'a.deb', bytes: 100 * MB }, rpm: { file: 'a.rpm', bytes: 90 * MB } }, { deb: 95 * MB, rpm: 95 * MB }, 'linux');
    expect(r.grown.map((g) => g.kind.key)).toEqual(['deb']);
  });

  it('finds the Linux packages and ignores a DMG beside them', () => {
    const files: Record<string, string[]> = { '/d': ['minerva_4.0.0_amd64.deb', 'minerva-4.0.0-1.x86_64.rpm', 'stray.dmg'] };
    const found = findArtifacts('/d', {
      readdirSync: ((dir: string) => (files[posix(dir)] ?? []).map((name) => ({ name, isDirectory: () => false }))) as never,
      statSync: (() => ({ size: 5 * MB })) as never,
      platform: 'linux',
    });
    expect(Object.keys(found).sort()).toEqual(['deb', 'rpm']);
  });

  it('Windows needs the Squirrel installer and its update payload (#2181)', () => {
    const files: Record<string, string[]> = { '/w': ['minerva-4.0.0-full.nupkg', 'Minerva-4.0.0 Setup.exe', 'RELEASES'] };
    const found = findArtifacts('/w', {
      readdirSync: ((dir: string) => (files[posix(dir)] ?? []).map((name) => ({ name, isDirectory: () => false }))) as never,
      statSync: (() => ({ size: 5 * MB })) as never,
      platform: 'win32',
    });
    expect(Object.keys(found).sort()).toEqual(['nupkg', 'setupExe']);
    expect(compare({ setupExe: found.setupExe! }, {}, 'win32').missing.map((m) => m.key)).toEqual(['nupkg']);
  });

  it('a platform with no release artifacts is an error, not an empty pass', () => {
    expect(() => kindsFor('freebsd')).toThrow(/no release artifacts/);
  });
});

describe('formatMb', () => {
  it('renders bytes as MB to one decimal', () => {
    expect(formatMb(243633039)).toBe('232.3 MB');
  });
});
