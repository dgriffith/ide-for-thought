/**
 * @vitest-environment happy-dom
 *
 * Find-in-Notes: what the dialog does with a search that is no longer the one
 * the user is waiting for (#2220).
 *
 * The dialog re-queries on a 200ms debounce while the user types, and a scan of
 * a large thoughtbase outlives the gap between keystrokes. Two things follow,
 * and both are correctness, not speed:
 *
 *   - main aborts the superseded scan and answers `{ ok: false, reason:
 *     'superseded' }` — which must leave the list and the spinner alone, not
 *     blank the results the way an `[]` would;
 *   - an abort is a race, not a guarantee. A scan that finished *just* before
 *     the newer one was issued still resolves, so the dialog drops any response
 *     that isn't the newest rather than trusting IPC to answer in order.
 *
 * Plus the cap: the dialog asks for at most `MATCH_LIMIT` matches, and says so
 * when the answer is truncated — because Replace All acts on exactly the
 * matches shown, and a partial replace that looks complete is the worst
 * available outcome.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

const { searchMock, replaceMock } = vi.hoisted(() => ({ searchMock: vi.fn(), replaceMock: vi.fn() }));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { notebase: { searchInNotes: searchMock } },
}));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({
  getNotebaseStore: () => ({ replaceInNotes: replaceMock }),
}));

import FindInNotesDialog from '../../../src/renderer/lib/components/FindInNotesDialog.svelte';

/** The 200ms search debounce, plus slack for the component's own microtasks. */
const DEBOUNCE_MS = 200;

function ok(paths: string[], over: Partial<{ totalMatches: number; truncated: boolean }> = {}) {
  const files = paths.map((p) => ({
    relativePath: p,
    matches: [{ line: 1, startCol: 0, endCol: 3, lineText: 'hit here' }],
  }));
  return { ok: true as const, files, totalMatches: over.totalMatches ?? files.length, truncated: over.truncated ?? false };
}

/** A promise plus the handles to settle it from the test. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderDialog() {
  const onJumpTo = vi.fn();
  const onClose = vi.fn();
  const r = render(FindInNotesDialog, { initialMode: 'find' as const, onJumpTo, onClose });
  const input = r.container.querySelector('input.input') as HTMLInputElement;
  return { ...r, input, onJumpTo, onClose };
}

/** Result rows currently rendered, by relative path. */
function shownPaths(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.file-path')].map((el) => el.textContent ?? '');
}

/** Type a pattern and let the debounce fire. */
async function type(input: HTMLInputElement, value: string) {
  await fireEvent.input(input, { target: { value } });
  await new Promise((r) => { setTimeout(r, DEBOUNCE_MS + 30); });
}

beforeEach(() => { searchMock.mockReset(); replaceMock.mockReset(); });
afterEach(cleanup);

describe('FindInNotesDialog — bounded, superseded-safe search (#2220)', () => {
  it('asks the main process for a bounded number of matches', async () => {
    searchMock.mockResolvedValue(ok(['a.md']));
    const { input } = renderDialog();
    await type(input, 'hit');

    await waitFor(() => { expect(searchMock).toHaveBeenCalled(); });
    const opts = searchMock.mock.calls.at(-1)![0] as { maxMatches?: number };
    // The specific number is a UI judgement call; that there IS one is not.
    // Without it a one-character query asked for every match in the corpus,
    // which measured 1,022,200 matches and a 150 MB IPC payload.
    expect(opts.maxMatches).toBeGreaterThan(0);
    expect(Number.isFinite(opts.maxMatches)).toBe(true);
  });

  it('ignores a stale response that lands after a newer query', async () => {
    const first = deferred<ReturnType<typeof ok>>();
    const second = deferred<ReturnType<typeof ok>>();
    searchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { input, container } = renderDialog();
    await type(input, 'a');
    await type(input, 'ab');
    expect(searchMock).toHaveBeenCalledTimes(2);

    // Newer query answers first, then the older one straggles in.
    second.resolve(ok(['new.md']));
    await waitFor(() => { expect(shownPaths(container)).toEqual(['new.md']); });
    first.resolve(ok(['stale.md']));
    await new Promise((r) => { setTimeout(r, 20); });

    // Without the generation guard the straggler wins, and the user sees
    // results for a pattern they already finished typing past.
    expect(shownPaths(container)).toEqual(['new.md']);
  });

  it('leaves the visible results alone when main reports the scan superseded', async () => {
    searchMock.mockResolvedValueOnce(ok(['kept.md']));
    const { input, container } = renderDialog();
    await type(input, 'a');
    await waitFor(() => { expect(shownPaths(container)).toEqual(['kept.md']); });

    // `{ ok: false }` is not `[]`. Blanking the list here would flicker the
    // results away on every keystroke a scan outlives.
    searchMock.mockResolvedValueOnce({ ok: false as const, reason: 'superseded' as const });
    await type(input, 'ab');
    await new Promise((r) => { setTimeout(r, 20); });
    expect(shownPaths(container)).toEqual(['kept.md']);
  });

  it('says so when the result was truncated, and stays quiet when it was not', async () => {
    searchMock.mockResolvedValue(ok(['a.md'], { totalMatches: 2000, truncated: true }));
    const { input, container } = renderDialog();
    await type(input, 'e');
    await waitFor(() => { expect(container.textContent).toContain('2000 match'); });
    // Replace All acts on exactly what is listed, so "there are more" has to be
    // visible — otherwise a partial replace reads as a complete one.
    expect(container.textContent).toContain('First');
    expect(container.textContent).toMatch(/narrow/i);

    searchMock.mockResolvedValue(ok(['a.md'], { totalMatches: 3, truncated: false }));
    await type(input, 'ep');
    await waitFor(() => { expect(container.textContent).toContain('3 matches'); });
    expect(container.textContent).not.toContain('First');
    expect(container.textContent).not.toMatch(/narrow/i);
  });
});
