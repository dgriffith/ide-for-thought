/**
 * @vitest-environment happy-dom
 *
 * Component-interaction coverage for the project-wide Find / Find & Replace
 * dialog (#306 / #307). FindInNotesDialog was ~0% covered: a debounced
 * search $effect, a per-match/per-file selection model, a two-mode
 * (find/replace) layout, and jump/replace callbacks all went unexercised.
 *
 * These tests render the real component and drive it the way a user does —
 * type a pattern, toggle the case/regex flags, click a match to jump, toggle
 * match/file checkboxes, and run Replace Selected / Replace All — asserting
 * the mocked `api.notebase.searchInNotes` and store `replaceInNotes` boundary
 * receive the right options, and that the visible DOM reflects the results.
 *
 * The 200ms search debounce runs under real timers; `waitFor` polls the DOM
 * / mock until the deferred search resolves, so the reactive path is proven
 * end to end rather than stubbed.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type {
  SearchInNotesFileResult,
  ReplaceInNotesResult,
} from '../../../src/shared/types';

const { searchMock, replaceMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { notebase: { searchInNotes: searchMock } },
}));

vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({
  getNotebaseStore: () => ({ replaceInNotes: replaceMock }),
}));

import FindInNotesDialog from '../../../src/renderer/lib/components/FindInNotesDialog.svelte';

type Mode = 'find' | 'replace';

/** Two files, three matches total. */
function makeResults(): SearchInNotesFileResult[] {
  return [
    {
      relativePath: 'notes/alpha.md',
      matches: [
        { line: 3, startCol: 4, endCol: 7, lineText: 'the foo is here' },
        { line: 7, startCol: 0, endCol: 3, lineText: 'foo again on this line' },
      ],
    },
    {
      relativePath: 'notes/beta.md',
      matches: [{ line: 1, startCol: 2, endCol: 5, lineText: 'a foo b' }],
    },
  ];
}

const REPLACE_RESULT: ReplaceInNotesResult = {
  changedPaths: ['notes/alpha.md', 'notes/beta.md'],
  replacedCount: 3,
};

function renderDialog(over: {
  initialMode?: Mode;
  onJumpTo?: (rel: string, line: number, col: number) => void;
  onClose?: () => void;
} = {}) {
  const onJumpTo = over.onJumpTo ?? vi.fn();
  const onClose = over.onClose ?? vi.fn();
  const r = render(FindInNotesDialog, {
    initialMode: over.initialMode ?? 'find',
    onJumpTo,
    onClose,
  });
  return { ...r, onJumpTo, onClose };
}

function patternInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input.input') as HTMLInputElement;
}

async function typePattern(container: HTMLElement, value: string) {
  await fireEvent.input(patternInput(container), { target: { value } });
}

beforeEach(() => {
  searchMock.mockReset();
  replaceMock.mockReset();
  searchMock.mockResolvedValue(makeResults());
  replaceMock.mockResolvedValue(REPLACE_RESULT);
});

afterEach(cleanup);

describe('FindInNotesDialog — find mode (#306)', () => {
  it('does not search while the pattern is blank', async () => {
    const { container } = renderDialog();
    // The mount $effect fires runSearch, but the debounced body returns
    // early for a blank pattern — searchInNotes is never called.
    await new Promise((r) => setTimeout(r, 250));
    expect(searchMock).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.file-group')).toHaveLength(0);
  });

  it('typing a pattern searches with the current flags and renders results', async () => {
    const { container, getByText } = renderDialog();
    await typePattern(container, 'foo');

    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith({
        pattern: 'foo',
        caseSensitive: false,
        regex: false,
      }),
    );

    // File groups + the match excerpts render.
    await waitFor(() => expect(getByText('notes/alpha.md')).toBeTruthy());
    expect(getByText('notes/beta.md')).toBeTruthy();
    // Match location label "line:col+1" (3:5) and the highlighted <mark>.
    expect(getByText('3:5')).toBeTruthy();
    expect(container.querySelectorAll('.match-jump')).toHaveLength(3);
    expect(container.querySelectorAll('mark')[0].textContent).toBe('foo');
    // Footer status summarizes the totals.
    expect(getByText('3 matches in 2 files')).toBeTruthy();
    // Find mode: no replacement input, no checkboxes, no replace actions.
    expect(container.querySelector('.match-check')).toBeNull();
    expect(container.querySelector('.replace-actions')).toBeNull();
  });

  it('toggling the case-sensitive and regex flags re-runs the search', async () => {
    const { container, getByTitle } = renderDialog();
    await typePattern(container, 'foo');
    await waitFor(() => expect(searchMock).toHaveBeenCalled());

    await fireEvent.click(getByTitle('Match case'));
    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith({
        pattern: 'foo',
        caseSensitive: true,
        regex: false,
      }),
    );

    await fireEvent.click(getByTitle('Regular expression'));
    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith({
        pattern: 'foo',
        caseSensitive: true,
        regex: true,
      }),
    );
  });

  it('clicking a match jumps to its path/line/col', async () => {
    const onJumpTo = vi.fn();
    const { container } = renderDialog({ onJumpTo });
    await typePattern(container, 'foo');
    await waitFor(() =>
      expect(container.querySelectorAll('.match-jump').length).toBe(3),
    );

    const jumps = container.querySelectorAll('.match-jump');
    await fireEvent.click(jumps[0]);
    expect(onJumpTo).toHaveBeenCalledWith('notes/alpha.md', 3, 4);

    await fireEvent.click(jumps[2]);
    expect(onJumpTo).toHaveBeenCalledWith('notes/beta.md', 1, 2);
  });

  it('collapsing a file header hides its match list', async () => {
    const { container, getByText } = renderDialog();
    await typePattern(container, 'foo');
    await waitFor(() =>
      expect(container.querySelectorAll('.match-list').length).toBe(2),
    );

    await fireEvent.click(getByText('notes/alpha.md'));
    // alpha collapses → one match-list remains (beta's).
    await waitFor(() =>
      expect(container.querySelectorAll('.match-list').length).toBe(1),
    );

    // Toggling back expands it again.
    await fireEvent.click(getByText('notes/alpha.md'));
    await waitFor(() =>
      expect(container.querySelectorAll('.match-list').length).toBe(2),
    );
  });

  it('shows the "No matches" status when the search returns nothing', async () => {
    searchMock.mockResolvedValue([]);
    const { container, getByText } = renderDialog();
    await typePattern(container, 'zzznope');
    await waitFor(() => expect(getByText('No matches')).toBeTruthy());
    expect(container.querySelectorAll('.file-group')).toHaveLength(0);
  });

  it('Escape and the close button both invoke onClose', async () => {
    const onClose = vi.fn();
    const { container, getByLabelText } = renderDialog({ onClose });

    await fireEvent.keyDown(container.querySelector('.overlay')!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent.click(getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('clicking the overlay backdrop closes the dialog', async () => {
    const onClose = vi.fn();
    const { container } = renderDialog({ onClose });
    const overlay = container.querySelector('.overlay') as HTMLElement;
    // mousedown where target === overlay itself (not a child) closes.
    await fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the mode segments switch between find and replace', async () => {
    const { container, getByText, getByPlaceholderText } = renderDialog();
    // Starts in find mode → no replacement input.
    expect(container.querySelector('input[placeholder="Replace with…"]')).toBeNull();

    await fireEvent.click(getByText('Find & Replace'));
    expect(getByPlaceholderText('Replace with…')).toBeTruthy();

    await fireEvent.click(getByText('Find'));
    expect(container.querySelector('input[placeholder="Replace with…"]')).toBeNull();
  });
});

describe('FindInNotesDialog — replace mode (#307)', () => {
  async function renderWithResults(over: Parameters<typeof renderDialog>[0] = {}) {
    const r = renderDialog({ initialMode: 'replace', ...over });
    await typePattern(r.container, 'foo');
    await waitFor(() =>
      expect(r.container.querySelectorAll('.match-jump').length).toBe(3),
    );
    return r;
  }

  it('renders per-match checkboxes and the replace action bar', async () => {
    const { container, getByText } = await renderWithResults();
    expect(container.querySelectorAll('.match-check')).toHaveLength(3);
    expect(container.querySelectorAll('.file-check')).toHaveLength(2);
    expect(getByText('Replace Selected')).toBeTruthy();
    expect(getByText('Replace All')).toBeTruthy();
    // Preview column shows the post-replacement line.
    expect(container.querySelector('.preview')).toBeTruthy();
  });

  it('Replace All sends every match as a selection with the replacement', async () => {
    const { getByText, getByPlaceholderText } = await renderWithResults();
    await fireEvent.input(getByPlaceholderText('Replace with…'), {
      target: { value: 'BAR' },
    });

    await fireEvent.click(getByText('Replace All'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    const opts = replaceMock.mock.calls[0][0];
    expect(opts.pattern).toBe('foo');
    expect(opts.replacement).toBe('BAR');
    expect(opts.selections).toHaveLength(3);
    expect(opts.selections[0]).toEqual({
      relativePath: 'notes/alpha.md',
      line: 3,
      startCol: 4,
      endCol: 7,
    });
    // Post-replace status is reported.
    await waitFor(() => expect(getByText('Replaced 3 matches in 2 files')).toBeTruthy());
  });

  it('Replace Selected excludes unchecked matches', async () => {
    const { container, getByText } = await renderWithResults();
    // Uncheck the first match, then replace only the selected ones.
    const checks = container.querySelectorAll('.match-check');
    await fireEvent.click(checks[0]);

    await fireEvent.click(getByText('Replace Selected'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    expect(replaceMock.mock.calls[0][0].selections).toHaveLength(2);
  });

  it('the file checkbox toggles every match in that file at once', async () => {
    const { container, getByText } = await renderWithResults();
    const fileChecks = container.querySelectorAll<HTMLInputElement>('.file-check');
    // alpha.md has 2 matches → its file-check starts fully checked.
    expect(fileChecks[0].checked).toBe(true);

    // Unchecking the file clears both of its matches from the selection.
    await fireEvent.click(fileChecks[0]);
    await fireEvent.click(getByText('Replace Selected'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    // Only beta.md's single match survives.
    const sel = replaceMock.mock.calls[0][0].selections;
    expect(sel).toHaveLength(1);
    expect(sel[0].relativePath).toBe('notes/beta.md');
  });

  it('Replace Selected with nothing checked reports "Nothing selected"', async () => {
    const { container, getByText } = await renderWithResults();
    // Uncheck all three matches.
    for (const c of container.querySelectorAll('.match-check')) {
      await fireEvent.click(c);
    }
    await fireEvent.click(getByText('Replace Selected'));

    await waitFor(() => expect(getByText('Nothing selected')).toBeTruthy());
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
