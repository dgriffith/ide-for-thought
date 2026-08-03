/**
 * Shared config load + validation (#1640). The point of the helper is that a
 * CORRUPT config is reported loudly + consistently instead of silently reading
 * back as defaults (the old per-file `catch { return defaults }`), while a
 * MISSING config still falls back silently. Also pins the shared field decoders.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadConfigFile,
  loadConfigFileSync,
  reportConfigError,
  asString,
  asBool,
  asFiniteNumber,
  asEnum,
  asRecord,
  asStringArray,
  stampConfigVersion,
  detectConfigVersion,
  CONFIG_VERSION_KEY,
} from '../../../src/main/config/config-store';

interface Cfg { name: string; count: number; on: boolean }
const DEFAULTS: Cfg = { name: 'default', count: 0, on: false };
const decode = (raw: unknown): Cfg => {
  const o = asRecord(raw);
  return {
    name: asString(o.name, DEFAULTS.name),
    count: asFiniteNumber(o.count, DEFAULTS.count),
    on: asBool(o.on, DEFAULTS.on),
  };
};

describe('config-store field decoders (#1640)', () => {
  it('asString / asBool / asFiniteNumber fall back on the wrong type', () => {
    expect(asString('x', 'd')).toBe('x');
    expect(asString(42, 'd')).toBe('d');
    expect(asBool(true, false)).toBe(true);
    expect(asBool('true', false)).toBe(false);
    expect(asFiniteNumber(3.5, 0)).toBe(3.5);
    expect(asFiniteNumber(NaN, 7)).toBe(7);
    expect(asFiniteNumber('3', 7)).toBe(7);
  });

  it('asEnum only accepts a member of the allowed set', () => {
    const modes = ['a', 'b'] as const;
    expect(asEnum('b', modes, 'a')).toBe('b');
    expect(asEnum('z', modes, 'a')).toBe('a');
  });

  it('asRecord rejects null / arrays / primitives', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toEqual({});
    expect(asRecord([1, 2])).toEqual({});
    expect(asRecord('x')).toEqual({});
  });

  it('asStringArray requires every element to be a string', () => {
    expect(asStringArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(asStringArray(['a', 1])).toEqual([]);
    expect(asStringArray('a')).toEqual([]);
  });
});

describe('loadConfigFile (#1640)', () => {
  let dir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-cfg-'));
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    errSpy.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const p = (name: string) => path.join(dir, name);

  it('returns defaults (silently) when the file is missing', async () => {
    await expect(loadConfigFile(() => p('missing.json'), decode, DEFAULTS)).resolves.toEqual(DEFAULTS);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('decodes a valid config', async () => {
    await fs.writeFile(p('ok.json'), JSON.stringify({ name: 'x', count: 5, on: true }), 'utf-8');
    await expect(loadConfigFile(() => p('ok.json'), decode, DEFAULTS)).resolves.toEqual({ name: 'x', count: 5, on: true });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('fills per-field defaults for a partial / wrong-typed config', async () => {
    await fs.writeFile(p('partial.json'), JSON.stringify({ name: 'x', count: 'nope' }), 'utf-8');
    await expect(loadConfigFile(() => p('partial.json'), decode, DEFAULTS)).resolves.toEqual({ name: 'x', count: 0, on: false });
  });

  it('REPORTS a corrupt config and falls back (not a silent swallow)', async () => {
    await fs.writeFile(p('corrupt.json'), '{ not valid json ', 'utf-8');
    await expect(loadConfigFile(() => p('corrupt.json'), decode, DEFAULTS)).resolves.toEqual(DEFAULTS);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]![0])).toContain('[config] failed to parse');
  });

  it('REPORTS a decode/validate throw and falls back', async () => {
    await fs.writeFile(p('bad.json'), JSON.stringify({ name: 'x' }), 'utf-8');
    const strict = () => { throw new Error('missing required field'); };
    await expect(loadConfigFile(() => p('bad.json'), strict, DEFAULTS)).resolves.toEqual(DEFAULTS);
    expect(String(errSpy.mock.calls[0]![0])).toContain('[config] failed to validate');
  });

  it('clones defaults so a mutated result cannot corrupt the singleton', async () => {
    const nested = { section: { flag: false } };
    const out = await loadConfigFile<typeof nested>(() => p('none.json'), (r) => r as typeof nested, nested);
    out.section.flag = true;
    expect(nested.section.flag).toBe(false);
  });

  it('loadConfigFileSync mirrors the async semantics', async () => {
    await fs.writeFile(p('sync.json'), JSON.stringify({ name: 'y', count: 2, on: true }), 'utf-8');
    expect(loadConfigFileSync(() => p('sync.json'), decode, DEFAULTS)).toEqual({ name: 'y', count: 2, on: true });
    await fs.writeFile(p('sync-bad.json'), 'nope', 'utf-8');
    expect(loadConfigFileSync(() => p('sync-bad.json'), decode, DEFAULTS)).toEqual(DEFAULTS);
    expect(errSpy).toHaveBeenCalled();
  });

  it('falls back to defaults (silently) when the path thunk throws', async () => {
    // Mirrors app.getPath('userData') throwing with no electron present: the
    // config is unlocatable, treated like a missing file — quiet, not reported.
    const boom = () => { throw new Error('no electron app'); };
    await expect(loadConfigFile(boom, decode, DEFAULTS)).resolves.toEqual(DEFAULTS);
    expect(loadConfigFileSync(boom, decode, DEFAULTS)).toEqual(DEFAULTS);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('reportConfigError formats a recognizable, prefixed message', () => {
    reportConfigError('/tmp/x.json', 'read', new Error('EACCES'));
    expect(String(errSpy.mock.calls.at(-1)![0])).toMatch(/^\[config\] failed to read "\/tmp\/x\.json": EACCES/);
  });

  // ── Versioning + migration (#1641) ──────────────────────────────────────────

  it('stampConfigVersion / detectConfigVersion round-trip; absent ⇒ 0', () => {
    const stamped = stampConfigVersion({ a: 1 }, 3);
    expect(stamped).toEqual({ a: 1, [CONFIG_VERSION_KEY]: 3 });
    expect(detectConfigVersion(stamped)).toBe(3);
    expect(detectConfigVersion({ a: 1 })).toBe(0); // legacy, unversioned
    expect(detectConfigVersion('nonsense')).toBe(0);
  });

  it('migrates a legacy (v0) config via a version-keyed migration — the shape-sniffing replacement', async () => {
    // A pre-versioning file with the OLD field name. v1 renames `label` → `name`.
    await fs.writeFile(p('legacy.json'), JSON.stringify({ label: 'hello', count: 9 }), 'utf-8');
    const migrate = (raw: Record<string, unknown>, from: number): Record<string, unknown> =>
      from < 1 ? { name: raw.label, count: raw.count, [CONFIG_VERSION_KEY]: 1 } : raw;

    const out = await loadConfigFile(() => p('legacy.json'), decode, DEFAULTS, { version: 1, migrate });
    expect(out).toEqual({ name: 'hello', count: 9, on: false });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('does NOT run the migration when the stored version is already current', async () => {
    await fs.writeFile(p('current.json'), JSON.stringify({ name: 'x', count: 1, on: true, [CONFIG_VERSION_KEY]: 1 }), 'utf-8');
    const migrate = vi.fn((raw: Record<string, unknown>) => raw);
    const out = await loadConfigFile(() => p('current.json'), decode, DEFAULTS, { version: 1, migrate });
    expect(out).toEqual({ name: 'x', count: 1, on: true });
    expect(migrate).not.toHaveBeenCalled();
  });

  it('a stamped config round-trips through save → load', async () => {
    await fs.writeFile(p('rt.json'), JSON.stringify(stampConfigVersion({ name: 'z', count: 4, on: true }, 1)), 'utf-8');
    await expect(loadConfigFile(() => p('rt.json'), decode, DEFAULTS, { version: 1 })).resolves.toEqual({ name: 'z', count: 4, on: true });
  });
});
