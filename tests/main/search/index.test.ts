/**
 * Debounced search-index persistence (perf #1107).
 *
 * `persist` serializes the whole MiniSearch index — O(total corpus bytes),
 * not O(the one changed note) — so the per-save write path now calls
 * `schedulePersist` (a debounced, coalescing wrapper) instead of `persist`
 * directly. These tests pin that contract: no immediate write, one write
 * after the quiet period, repeated calls coalesce to a single write, and an
 * explicit `persist()` still forces an immediate write (the release/quit
 * paths keep calling that).
 *
 * Uses `_setPersistDebounceMsForTests` to shrink the real debounce window
 * rather than mocking time — `schedulePersist`'s timer callback does real
 * `fs` I/O, which doesn't resolve on vitest's fake-timer clock (it settles
 * via libuv's real thread pool), so faking `setTimeout` here would just trade
 * a slow test for a flaky one. To stay robust on a loaded CI runner (where a
 * `setTimeout` slips and the async write flushes late), the "did write"
 * assertions POLL for the file via `waitForIndex` rather than assuming a fixed
 * sleep landed it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initSearch,
  indexNote,
  persist,
  schedulePersist,
  disposeProject,
  _setPersistDebounceMsForTests,
} from '../../../src/main/search/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const DEBOUNCE_MS = 200;

function indexFilePath(root: string): string {
  return path.join(root, '.minerva', 'search-index.json');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Poll until the debounced write has landed AND the file is fully written
 * (non-empty + parseable) — waits out both the timer firing and the async fs
 * flush, so a loaded runner can't race the assertion. Throws on timeout.
 */
async function waitForIndex(root: string, timeoutMs = 5000): Promise<unknown> {
  const p = indexFilePath(root);
  const start = Date.now();
  for (;;) {
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      if (raw) return JSON.parse(raw);
    } catch {
      // Not written yet, or caught mid-write — keep polling.
    }
    if (Date.now() - start > timeoutMs) throw new Error(`search index not written within ${timeoutMs}ms`);
    await sleep(10);
  }
}

describe('search index persistence (perf #1107)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-search-persist-'));
    fs.mkdirSync(path.join(root, '.minerva'), { recursive: true });
    ctx = projectContext(root);
    await initSearch(ctx);
    _setPersistDebounceMsForTests(DEBOUNCE_MS);
  });

  afterEach(() => {
    _setPersistDebounceMsForTests(3000);
    disposeProject(ctx);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('schedulePersist does not write immediately', () => {
    indexNote(ctx, 'a.md', '# A\nbody');
    schedulePersist(ctx);
    expect(fs.existsSync(indexFilePath(root))).toBe(false);
  });

  it('schedulePersist writes after the debounce delay elapses', async () => {
    indexNote(ctx, 'a.md', '# A\nbody');
    schedulePersist(ctx);

    await sleep(DEBOUNCE_MS / 2);
    expect(fs.existsSync(indexFilePath(root))).toBe(false);

    const written = await waitForIndex(root);
    expect(JSON.stringify(written)).toContain('a.md');
  });

  it('repeated schedulePersist calls within the window coalesce into one write', async () => {
    indexNote(ctx, 'a.md', '# A\nbody');
    schedulePersist(ctx);
    await sleep(DEBOUNCE_MS / 2);
    // A second save comes in before the first would have fired — this
    // should push the write out again rather than let the first fire.
    indexNote(ctx, 'b.md', '# B\nbody');
    schedulePersist(ctx);
    await sleep(DEBOUNCE_MS / 2);
    expect(fs.existsSync(indexFilePath(root))).toBe(false);

    const written = await waitForIndex(root);
    // Both notes made it into the single, coalesced write.
    expect(JSON.stringify(written)).toContain('a.md');
    expect(JSON.stringify(written)).toContain('b.md');
  });

  it('persist() forces an immediate write and cancels a pending scheduled one', async () => {
    indexNote(ctx, 'a.md', '# A\nbody');
    schedulePersist(ctx);
    expect(fs.existsSync(indexFilePath(root))).toBe(false);

    await persist(ctx);
    expect(fs.existsSync(indexFilePath(root))).toBe(true);
    const firstWrite = fs.statSync(indexFilePath(root)).mtimeMs;

    // The debounced timer that was pending before persist() ran should have
    // been cancelled — waiting past its original deadline must not fire a
    // second, redundant write.
    await sleep(DEBOUNCE_MS * 2);
    expect(fs.statSync(indexFilePath(root)).mtimeMs).toBe(firstWrite);
  });
});
