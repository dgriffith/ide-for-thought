/**
 * @vitest-environment node
 *
 * `readProjectConfig` reads `.minerva/config.json` once, not once per caller
 * (#2226, epic #2229) — and never answers with a stale one.
 *
 * Before this, every `readProjectConfig` was a fresh `readFileSync` +
 * `JSON.parse`. Measured in the real app through the preload bridge, one
 * caller is on a repeating path: `citations/render-inline.ts` runs
 * `getBibliographyStyleId` once per `CITATION_RENDER_INLINE`, i.e. once per
 * 120ms-debounced preview re-render, so typing in a note that cites something
 * was ~8 blocking reads a second. Twenty preview renders = twenty reads.
 *
 * The speed half is gated by COUNT, not by a millisecond threshold (#2229):
 * "N calls, one read" holds on a loaded CI box; a timing assertion flaps.
 *
 * **The staleness half matters more than the speed half** and gets most of the
 * cases below. The file has one in-app writer (`patchRawProjectConfig`, which
 * `patchProjectConfig` AND `graph/index.ts`'s `baseUri` both route through)
 * and is also editable on disk by the user, so there are three ways a stale
 * answer could be served and each has its own case here:
 *
 *   - this app patched it            → invalidated at the writer;
 *   - something outside rewrote it   → the `statSync` stamp;
 *   - the memo was dropped by hand   → `invalidateProjectConfigCache()`,
 *                                      which window focus calls.
 *
 * Counting reads needs `vi.mock('node:fs')` rather than `vi.spyOn(fs, …)`:
 * `config-store.ts` does `import { readFileSync } from 'node:fs'`, and a named
 * import binds a copy of the function, not the namespace property — spying on
 * the namespace provably cannot intercept it (the finding that shaped #2221's
 * test file).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

/** Absolute paths handed to `readFileSync` / `statSync`, in call order. */
const io = vi.hoisted(() => ({
  reads: [] as string[],
  stats: [] as string[],
  /**
   * Make `statSync` report the same mtime/ctime/size no matter what is on
   * disk — a stand-in for a filesystem whose timestamps are too coarse to
   * distinguish two writes (some SMB/network mounts stamp to the second).
   * With the stamp pinned, the ONLY thing that can keep the memo honest is
   * the explicit invalidation at the writer, which is exactly what it
   * isolates.
   */
  pinStamp: false,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readFileSync = ((p: string, ...rest: unknown[]) => {
    io.reads.push(String(p));
    return (actual.readFileSync as (...a: unknown[]) => unknown)(p, ...rest);
  }) as typeof actual.readFileSync;
  const statSync = ((p: string, ...rest: unknown[]) => {
    io.stats.push(String(p));
    const st = (actual.statSync as (...a: unknown[]) => Record<string, unknown>)(p, ...rest);
    if (!io.pinStamp) return st;
    return Object.assign(Object.create(Object.getPrototypeOf(st) as object) as object, st, {
      mtimeMs: 1_000_000, ctimeMs: 1_000_000, size: 42,
    });
  }) as typeof actual.statSync;
  const patched = { ...actual, readFileSync, statSync };
  return { ...patched, default: patched };
});

// Imported after the mock so both reach the patched `node:fs`.
const fs = (await import('node:fs')).default;
const { readProjectConfig, patchProjectConfig, getBibliographyStyleId, setBibliographyStyleId,
  getExcerptNoteFolder, setExcerptNoteFolder, resolveDisplayName, invalidateDisplayNameCache } =
  await import('../../../src/main/project-config');
const { readRawProjectConfig, patchRawProjectConfig } =
  await import('../../../src/main/config/project-config-store');
const { invalidateProjectConfigCache } =
  await import('../../../src/main/config/project-config-cache');

import { useTempDir } from '../../helpers/temp-project';

const project = useTempDir('minerva-project-config-cache-test-');

function configFile(root: string): string {
  return path.join(root, '.minerva', 'config.json');
}

/** Write config.json WITHOUT going through the app's writer — what a user
 *  editing the file in another application does. */
function writeBehindTheApp(root: string, cfg: Record<string, unknown>): void {
  fs.mkdirSync(path.join(root, '.minerva'), { recursive: true });
  fs.writeFileSync(configFile(root), JSON.stringify(cfg, null, 2), 'utf-8');
}

/** How many times config.json itself was read off disk since `resetIo()`. */
function configReads(): number {
  return io.reads.filter((p) => p.endsWith(`${path.sep}config.json`)).length;
}

function resetIo(): void {
  io.reads.length = 0;
  io.stats.length = 0;
}

beforeEach(() => {
  // The memo is a module-level singleton, so each test starts from a known
  // empty one. Every test also gets a fresh `root` from `useTempDir`, but a
  // memo tagged with the PREVIOUS test's rootPath would still be a live entry
  // whose presence the read-count assertions can see.
  invalidateProjectConfigCache();
  invalidateDisplayNameCache();
  io.pinStamp = false;
  resetIo();
});

describe('the memo removes the repeated read (#2226)', () => {
  it('twenty preview-style style lookups read config.json once', () => {
    patchProjectConfig(project.root, { bibliography: { styleId: 'mla' } });
    resetIo();

    // What twenty 120ms preview ticks in a note with a citation do.
    for (let i = 0; i < 20; i++) expect(getBibliographyStyleId(project.root)).toBe('mla');

    expect(configReads()).toBe(1);
    // …and it did stat each time: that is the mechanism, not an accident.
    expect(io.stats.filter((p) => p.endsWith(`${path.sep}config.json`)).length).toBe(20);
  });

  it('different readers of the same file share the one read', () => {
    patchProjectConfig(project.root, {
      displayName: 'Shared', bibliography: { styleId: 'apa' }, excerpt: { noteFolder: 'clips' },
    });
    resetIo();

    expect(getBibliographyStyleId(project.root)).toBe('apa');
    expect(getExcerptNoteFolder(project.root)).toBe('clips');
    expect(readProjectConfig(project.root).displayName).toBe('Shared');
    expect(resolveDisplayName(project.root)).toBe('Shared');

    expect(configReads()).toBe(1);
  });

  it('a project with no config.json is memoized as absent, not re-read', () => {
    // The equivalent of #2221's "cache the absence too": a thoughtbase that
    // has never been written to must not pay a failed `open` per call. One
    // attempt, on the first call — the ENOENT → `{}` policy stays owned by
    // `loadConfigFileSync` rather than being second-guessed from the stamp,
    // so the miss path still goes through it once.
    for (let i = 0; i < 10; i++) expect(readProjectConfig(project.root)).toEqual({});
    expect(configReads()).toBe(1);
  });

  it('never answers one thoughtbase with another one\'s config', () => {
    const other = fs.mkdtempSync(path.join(project.root, 'other-'));
    patchProjectConfig(project.root, { bibliography: { styleId: 'mla' } });
    patchProjectConfig(other, { bibliography: { styleId: 'chicago-author-date' } });

    // The stamp is pinned on purpose. Two real config.json files almost always
    // differ in mtime or size, so with a live stamp this case passes even if
    // the memo forgets which thoughtbase it holds — verified by reintroducing
    // exactly that defect, which every assertion here then survived. Pinning
    // makes the two files indistinguishable to `statSync`, leaving the
    // rootPath tag as the only thing that can tell them apart.
    io.pinStamp = true;
    expect(getBibliographyStyleId(project.root)).toBe('mla');
    expect(getBibliographyStyleId(other)).toBe('chicago-author-date');
    expect(getBibliographyStyleId(project.root)).toBe('mla');
  });
});

describe('a write is visible immediately (#2226)', () => {
  it('a style set through the app is read back without any invalidation', () => {
    setBibliographyStyleId(project.root, 'apa');
    expect(getBibliographyStyleId(project.root)).toBe('apa');
    setBibliographyStyleId(project.root, 'mla');
    expect(getBibliographyStyleId(project.root)).toBe('mla');
  });

  it('read-modify-write through the app keeps the unrelated keys it read', () => {
    // `setExcerptNoteFolder` reads the memo, spreads it, and patches. If the
    // memo handed it a stale `excerpt` slice this silently loses a field.
    patchProjectConfig(project.root, { excerpt: { noteFolder: 'first' } });
    setExcerptNoteFolder(project.root, 'second/');
    expect(getExcerptNoteFolder(project.root)).toBe('second');
    expect(readProjectConfig(project.root).excerpt).toEqual({ noteFolder: 'second' });
  });

  it('a baseUri written straight through patchRawProjectConfig is visible', () => {
    // `graph/index.ts` bypasses `patchProjectConfig` entirely. #2221's
    // display-name memo had to name this as a known gap it could not close
    // (invalidating from the leaf would have been a module cycle); invalidating
    // in the leaf itself is what closes it here.
    patchProjectConfig(project.root, { displayName: 'Named' });
    expect(readProjectConfig(project.root).baseUri).toBeUndefined();

    patchRawProjectConfig(project.root, { baseUri: 'https://example.com/tb/' });
    expect(readProjectConfig(project.root).baseUri).toBe('https://example.com/tb/');
    expect(readProjectConfig(project.root).displayName).toBe('Named');
  });

  it('a config.json created after an absent read is picked up', () => {
    expect(readProjectConfig(project.root)).toEqual({});
    patchProjectConfig(project.root, { bibliography: { styleId: 'apa' } });
    expect(getBibliographyStyleId(project.root)).toBe('apa');
  });
});

describe('an edit made outside the app is picked up (#2226)', () => {
  it('a config.json rewritten behind the app\'s back is seen on the next read', () => {
    patchProjectConfig(project.root, { bibliography: { styleId: 'apa' } });
    expect(getBibliographyStyleId(project.root)).toBe('apa');

    // No invalidation call — this is what a text editor does. The `statSync`
    // stamp is the only thing that can catch it.
    writeBehindTheApp(project.root, { bibliography: { styleId: 'chicago-author-date' } });
    expect(getBibliographyStyleId(project.root)).toBe('chicago-author-date');
  });

  it('a config.json deleted behind the app\'s back reads as empty again', () => {
    patchProjectConfig(project.root, { bibliography: { styleId: 'apa' } });
    expect(getBibliographyStyleId(project.root)).toBe('apa');

    fs.rmSync(configFile(project.root));
    expect(readProjectConfig(project.root)).toEqual({});
  });

  it('an in-app patch is visible even when the stamp cannot move', () => {
    // The stamp and the writer-side invalidation are two independent
    // guarantees, and with both on, the stamp alone would pass this. Pinning
    // it isolates the other one: on a filesystem that cannot distinguish two
    // writes, `patchRawProjectConfig`'s `invalidateProjectConfigCache()` is
    // the only thing left, and the app genuinely does patch-then-read-back
    // (`setExcerptNoteFolder`, `upsertPublishTarget`).
    patchProjectConfig(project.root, { bibliography: { styleId: 'apa' } });
    io.pinStamp = true;
    expect(getBibliographyStyleId(project.root)).toBe('apa');

    setBibliographyStyleId(project.root, 'mla');
    expect(getBibliographyStyleId(project.root)).toBe('mla');
  });

  it('invalidateProjectConfigCache() forces the next read to go to disk', () => {
    // The window-`focus` backstop (`invalidateMenuInputCaches`), for a
    // filesystem whose timestamps are too coarse for the stamp to help.
    patchProjectConfig(project.root, { bibliography: { styleId: 'apa' } });
    expect(getBibliographyStyleId(project.root)).toBe('apa');
    resetIo();

    expect(getBibliographyStyleId(project.root)).toBe('apa');
    expect(configReads()).toBe(0);

    invalidateProjectConfigCache();
    expect(getBibliographyStyleId(project.root)).toBe('apa');
    expect(configReads()).toBe(1);
  });
});

describe('the memo does not change what the readers promise', () => {
  it('a corrupt file still soft-fails to {} for the lenient reader (#1640)', () => {
    fs.mkdirSync(path.join(project.root, '.minerva'), { recursive: true });
    fs.writeFileSync(configFile(project.root), '{ not valid json', 'utf-8');
    expect(readProjectConfig(project.root)).toEqual({});
    // …and it stays soft-failing rather than caching its way into a throw.
    expect(readProjectConfig(project.root)).toEqual({});
  });

  it('a corrupt file still THROWS for readRawProjectConfig (#1891)', () => {
    // The patch path must never merge onto a silently-emptied `{}`. The memo
    // sits only under the lenient reader; a cached `{}` must not leak into the
    // read half of the read-modify-write.
    patchProjectConfig(project.root, { displayName: 'Precious' });
    expect(readProjectConfig(project.root).displayName).toBe('Precious');

    fs.writeFileSync(configFile(project.root), '{ not valid json', 'utf-8');
    expect(readProjectConfig(project.root)).toEqual({});
    expect(() => readRawProjectConfig(project.root)).toThrow();
    expect(() => patchProjectConfig(project.root, { displayName: 'Overwrite' })).toThrow();
    expect(fs.readFileSync(configFile(project.root), 'utf-8')).toBe('{ not valid json');
  });

  it('the shared result is frozen, so a caller cannot corrupt the memo', () => {
    patchProjectConfig(project.root, { bibliography: { styleId: 'apa' } });
    const cfg = readProjectConfig(project.root);
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.bibliography)).toBe(true);
    expect(() => { (cfg as { baseUri?: string }).baseUri = 'https://nope/'; }).toThrow(TypeError);
    expect(getBibliographyStyleId(project.root)).toBe('apa');
  });
});
