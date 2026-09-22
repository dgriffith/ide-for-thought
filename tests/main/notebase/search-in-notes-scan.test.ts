/**
 * @vitest-environment node
 *
 * Find-in-Notes scan contract (#2220).
 *
 * The dialog re-runs this on a 200ms debounce while the user types, so these
 * assertions are deliberately about COUNTS, not milliseconds — "this path reads
 * each file once" is a gate that means the same thing on a loaded CI box, and a
 * millisecond threshold is not. (The same A/B measured 14.0s before / 0.85s
 * after on a loaded machine and 1.24s / 0.09s on an idle one: a 16x swing in
 * the absolute numbers, and not one file's difference in the counts.)
 *
 * What the counts replace, on a 2,000-note / 11.6 MB corpus with a warm page
 * cache: typing a seven-character word cost 14,000 `readFile` calls and a peak
 * IPC payload of 150.68 MB — the single character `"e"` matched 1,022,200
 * times. After: 401 reads on a cold cache, 0 on a warm one, 0.32 MB.
 *
 * Three mechanisms are under test and they fail differently, so each has its
 * own assertions:
 *
 *   - the mtime-validated body cache — must not re-read unchanged files, and
 *     must not serve stale bytes for a note written a moment ago;
 *   - `maxMatches` — must stop the scan early, must report `truncated`
 *     EXACTLY (no "there may be more" on a complete result), and must leave
 *     uncapped callers (`grep_notes`, the CLI) with exact totals;
 *   - the abort signal — must reject rather than hand back a partial result.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchInNotes, matchesForContent, isSearchSuperseded } from '../../../src/main/notebase/search-in-notes';
import { _clearNoteContentCacheForTests } from '../../../src/main/notebase/note-content-cache';

let root: string;

function write(rel: string, body: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf-8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-in-notes-'));
  _clearNoteContentCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

/** Count `fs.readFile` calls landing inside the temp corpus. */
function countReads(): { calls: () => string[] } {
  const spy = vi.spyOn(fsp, 'readFile');
  return {
    calls: () =>
      spy.mock.calls
        // Every call on this path passes an absolute path string; anything
        // else (a FileHandle, a URL) isn't ours and is filtered out below.
        .map((c) => (typeof c[0] === 'string' ? c[0] : ''))
        .filter((p) => p.startsWith(root)),
  };
}

describe('searchInNotes — body cache', () => {
  it('reads each file exactly once for a scan, and not at all on an unchanged re-scan', async () => {
    for (let i = 0; i < 12; i++) write(`folder-${i % 3}/note-${i}.md`, `line one\nneedle in ${i}\ntail`);
    const reads = countReads();

    const first = await searchInNotes(root, { pattern: 'needle', caseSensitive: false, regex: false });
    expect(first.files).toHaveLength(12);
    const firstPass = reads.calls();
    expect(firstPass).toHaveLength(12);
    // Once each — a second read of the same path in one scan is the bug this
    // count exists to catch.
    expect(new Set(firstPass).size).toBe(12);

    const second = await searchInNotes(root, { pattern: 'needle', caseSensitive: false, regex: false });
    expect(second.files).toHaveLength(12);
    expect(reads.calls()).toHaveLength(12); // no new reads at all

    // A different pattern over the same bytes is still zero reads: what
    // changed between keystrokes is the regex, not the corpus.
    await searchInNotes(root, { pattern: 'tail', caseSensitive: false, regex: false });
    expect(reads.calls()).toHaveLength(12);
  });

  it('sees a note created between two scans', async () => {
    write('a.md', 'needle here');
    expect((await searchInNotes(root, { pattern: 'needle', caseSensitive: false, regex: false })).files)
      .toHaveLength(1);

    write('sub/b.md', 'needle there too');
    const after = await searchInNotes(root, { pattern: 'needle', caseSensitive: false, regex: false });
    expect(after.files.map((f) => f.relativePath)).toEqual(['a.md', 'sub/b.md']);
  });

  it('sees a note REWRITTEN between two scans, including a same-length rewrite', async () => {
    write('a.md', 'needle one');
    expect((await searchInNotes(root, { pattern: 'needle', caseSensitive: false, regex: false })).totalMatches)
      .toBe(1);

    // Same byte length, different content — the case a size-only cache key
    // would miss, and the one that would silently show the user yesterday's
    // text for a note they just edited.
    write('a.md', 'needle two');
    const changed = await searchInNotes(root, { pattern: 'two', caseSensitive: false, regex: false });
    expect(changed.totalMatches).toBe(1);
    expect(changed.files[0]!.matches[0]!.lineText).toBe('needle two');

    const gone = await searchInNotes(root, { pattern: 'one', caseSensitive: false, regex: false });
    expect(gone.files).toEqual([]);
  });

  it('stops reporting a note deleted between two scans', async () => {
    write('a.md', 'needle');
    write('b.md', 'needle');
    expect((await searchInNotes(root, { pattern: 'needle', caseSensitive: false, regex: false })).files)
      .toHaveLength(2);

    fs.rmSync(path.join(root, 'b.md'));
    const after = await searchInNotes(root, { pattern: 'needle', caseSensitive: false, regex: false });
    expect(after.files.map((f) => f.relativePath)).toEqual(['a.md']);
  });

  it('does not serve a deleted note\'s bytes to a file recreated at the same path', async () => {
    write('a.md', 'old contents with needle');
    await searchInNotes(root, { pattern: 'needle', caseSensitive: false, regex: false });

    fs.rmSync(path.join(root, 'a.md'));
    expect((await searchInNotes(root, { pattern: 'needle', caseSensitive: false, regex: false })).files).toEqual([]);

    // Freshness here is the STAMP's doing, not the ENOENT eviction's — the
    // recreated file has a new mtime either way. The eviction exists to keep a
    // deleted file's bytes from occupying the budget until the project closes,
    // which is a memory property no assertion about results can observe; it is
    // deliberately not claimed by this test.
    write('a.md', 'brand new contents');
    const revived = await searchInNotes(root, { pattern: 'needle', caseSensitive: false, regex: false });
    expect(revived.files).toEqual([]);
    const fresh = await searchInNotes(root, { pattern: 'brand new', caseSensitive: false, regex: false });
    expect(fresh.files.map((f) => f.relativePath)).toEqual(['a.md']);
  });
});

describe('searchInNotes — maxMatches', () => {
  beforeEach(() => {
    // 20 notes x 5 matches = 100 matches, in a deterministic path order.
    for (let i = 0; i < 20; i++) {
      write(`n${String(i).padStart(2, '0')}.md`, Array.from({ length: 5 }, (_, l) => `hit ${i}-${l}`).join('\n'));
    }
  });

  it('stops the scan early, and stops READING early', async () => {
    const reads = countReads();
    const capped = await searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false, maxMatches: 10 });

    expect(capped.totalMatches).toBe(10);
    expect(capped.truncated).toBe(true);
    // The whole point: the corpus is 20 files and we touched a handful.
    expect(reads.calls().length).toBeLessThanOrEqual(3);
    expect(capped.files.map((f) => f.relativePath)).toEqual(['n00.md', 'n01.md']);
  });

  it('caps a single file\'s matches inside the scan, not by trimming afterwards', async () => {
    // Asserted on `matchesForContent` directly and ON PURPOSE. Collecting
    // 5,000 matches and slicing to 7 returns an identical result, so no
    // assertion about `searchInNotes`'s OUTPUT can tell the two apart — and the
    // difference is exactly the peak allocation that made a one-character query
    // cost 150 MB. The only place the distinction is visible is here.
    const text = Array.from({ length: 5000 }, (_, l) => `hit line ${l}`).join('\n');
    expect(matchesForContent(text, /hit/g, 7)).toHaveLength(7);
    expect(matchesForContent(text, /hit/g, 0)).toHaveLength(0);
    expect(matchesForContent(text, /hit/g, Infinity)).toHaveLength(5000);

    // And the cap is honoured end-to-end through the scan.
    write('huge.md', text);
    const capped = await searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false, maxMatches: 7 });
    expect(capped.totalMatches).toBe(7);
  });

  it('reports truncated=false when the corpus has EXACTLY the cap many matches', async () => {
    // The off-by-one that tells a user to narrow a search that is already
    // complete. The scan collects one match past the cap to know the difference.
    const exact = await searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false, maxMatches: 100 });
    expect(exact.totalMatches).toBe(100);
    expect(exact.truncated).toBe(false);

    const oneShort = await searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false, maxMatches: 99 });
    expect(oneShort.totalMatches).toBe(99);
    expect(oneShort.truncated).toBe(true);
  });

  it('returns the same matches every time a capped query is re-run', async () => {
    // A cap keeps a PREFIX, so the traversal order has to be deterministic;
    // raw `readdir` order is filesystem-defined and was free to differ.
    const a = await searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false, maxMatches: 13 });
    const b = await searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false, maxMatches: 13 });
    expect(b).toEqual(a);
    expect(a.files.map((f) => f.relativePath)).toEqual(['n00.md', 'n01.md', 'n02.md']);
  });

  it('leaves an uncapped caller with every match and an exact total', async () => {
    // `grep_notes` and `cli/engine.ts` report this number to a model / a user
    // and promise it is the real one.
    const all = await searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false });
    expect(all.totalMatches).toBe(100);
    expect(all.truncated).toBe(false);
    expect(all.files).toHaveLength(20);
  });
});

describe('searchInNotes — abort', () => {
  it('rejects with a superseded error instead of returning a partial result', async () => {
    for (let i = 0; i < 40; i++) write(`n${String(i).padStart(2, '0')}.md`, 'hit');
    const controller = new AbortController();
    controller.abort();

    const reads = countReads();
    await expect(searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false }, controller.signal))
      .rejects.toSatisfy(isSearchSuperseded);
    // Aborted before the first file — the point is that it stops doing work,
    // not merely that it stops answering.
    expect(reads.calls()).toHaveLength(0);
  });

  it('stops mid-scan when the signal fires after it has started', async () => {
    for (let i = 0; i < 40; i++) write(`n${String(i).padStart(2, '0')}.md`, 'hit');
    const controller = new AbortController();

    // Abort once five files are in, by piggy-backing on the real read. This is
    // the shape that matters in production — the signal fires while the scan is
    // already walking, not before it starts.
    const realRead = fsp.readFile.bind(fsp);
    let reads = 0;
    const spy = vi.spyOn(fsp, 'readFile').mockImplementation(async (...args: unknown[]) => {
      reads++;
      if (reads >= 5) controller.abort();
      return await (realRead as (...a: unknown[]) => Promise<string>)(...args);
    });

    await expect(searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false }, controller.signal))
      .rejects.toSatisfy(isSearchSuperseded);
    expect(reads).toBeGreaterThanOrEqual(5);
    expect(reads).toBeLessThan(40);
    spy.mockRestore();
  });

  it('completes normally when the signal never fires', async () => {
    write('a.md', 'hit');
    const controller = new AbortController();
    const r = await searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false }, controller.signal);
    expect(r.totalMatches).toBe(1);
  });
});
