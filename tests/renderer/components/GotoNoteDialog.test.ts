/**
 * @vitest-environment happy-dom
 *
 * Rune-reactivity coverage for the quick-open fuzzy finder (GotoNoteDialog,
 * #1002). The dialog is a nest of runes: a `$derived.by` scored/filtered
 * result list, a `$state` selectedIndex that a `.selected` class reacts to,
 * and an `$effect` that resets the selection whenever the results change.
 *
 * These tests drive the real component the way a user does — type to filter,
 * arrow to move, Enter/click to pick — and assert the visible DOM and the
 * onSelect callback, so a stale `$derived`/`$effect` (results not narrowing,
 * a click firing with a stale row) fails the suite. The fuzzy scoring
 * (scoreMatch) runs for real; nothing is stubbed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/svelte';
import type { NoteFile } from '../../../src/shared/types';
import GotoNoteDialog from '../../../src/renderer/lib/components/GotoNoteDialog.svelte';

afterEach(cleanup);

// Flatten order (depth-first): Readme, Recipes, Project Plan, Ideas.
function makeFiles(): NoteFile[] {
  return [
    { name: 'Readme.md', relativePath: 'Readme.md', isDirectory: false, mtimeMs: Date.now() },
    { name: 'Recipes.md', relativePath: 'Recipes.md', isDirectory: false },
    { name: 'Project Plan.md', relativePath: 'Project Plan.md', isDirectory: false },
    {
      name: 'notes',
      relativePath: 'notes',
      isDirectory: true,
      children: [
        { name: 'Ideas.md', relativePath: 'notes/Ideas.md', isDirectory: false },
      ],
    },
  ];
}

function renderDialog(over: {
  onSelect?: (p: string) => void;
  onCancel?: () => void;
  files?: NoteFile[];
} = {}) {
  const onSelect = over.onSelect ?? vi.fn();
  const onCancel = over.onCancel ?? vi.fn();
  const r = render(GotoNoteDialog, {
    files: over.files ?? makeFiles(),
    onSelect,
    onCancel,
  });
  return { ...r, onSelect, onCancel };
}

/** Visible result rows, in DOM (score) order, by their display name. */
function resultNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.goto-results .result-name')].map(
    (el) => el.textContent ?? '',
  );
}

/** The single currently-highlighted row's name, or null. */
function selectedName(container: HTMLElement): string | null {
  const el = container.querySelector('.result-item.selected .result-name');
  return el ? el.textContent : null;
}

async function type(input: Element, value: string) {
  await fireEvent.input(input, { target: { value } });
}

describe('GotoNoteDialog — rune reactivity (#1002)', () => {
  it('lists every note when the query is empty (flatten order preserved)', () => {
    const { container } = renderDialog();
    expect(resultNames(container)).toEqual(['Readme', 'Recipes', 'Project Plan', 'Ideas']);
  });

  it('typing reactively narrows the $derived result list', async () => {
    const { container, getByPlaceholderText } = renderDialog();
    const input = getByPlaceholderText('Go to...');

    // "readme" is a substring of Readme only; no other note (or its path)
    // fuzzy-matches it, so the rest drop out.
    await type(input, 'readme');
    expect(resultNames(container)).toEqual(['Readme']);

    // Broaden back out: "re" matches Readme/Recipes (substring) + Project
    // Plan (fuzzy r..e). Ideas has no 'r' before an 'e', so it stays gone.
    await type(input, 're');
    const names = resultNames(container);
    expect(names).toContain('Readme');
    expect(names).toContain('Recipes');
    expect(names).toContain('Project Plan');
    expect(names).not.toContain('Ideas');
  });

  it('orders results by descending score (substring above fuzzy)', async () => {
    const { container, getByPlaceholderText } = renderDialog();
    await type(getByPlaceholderText('Go to...'), 're');

    const names = resultNames(container);
    // Readme/Recipes score 100 (substring); Project Plan scores 50 (fuzzy)
    // and must sort last.
    expect(names.indexOf('Readme')).toBeLessThan(names.indexOf('Project Plan'));
    expect(names.indexOf('Recipes')).toBeLessThan(names.indexOf('Project Plan'));
    expect(names[names.length - 1]).toBe('Project Plan');
  });

  it('ArrowDown/ArrowUp move the highlighted row; Enter selects it', async () => {
    const onSelect = vi.fn();
    const { container } = renderDialog({ onSelect });
    const overlay = container.querySelector('.overlay')!;

    // Row 0 (Readme) is highlighted initially.
    expect(selectedName(container)).toBe('Readme');

    await fireEvent.keyDown(overlay, { key: 'ArrowDown' }); // → Recipes
    await fireEvent.keyDown(overlay, { key: 'ArrowDown' }); // → Project Plan
    expect(selectedName(container)).toBe('Project Plan');

    await fireEvent.keyDown(overlay, { key: 'ArrowUp' }); // → Recipes
    expect(selectedName(container)).toBe('Recipes');

    await fireEvent.keyDown(overlay, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('Recipes.md');
  });

  it('resets the highlight to the top row after the results change ($effect)', async () => {
    const { container, getByPlaceholderText } = renderDialog();
    const overlay = container.querySelector('.overlay')!;

    await fireEvent.keyDown(overlay, { key: 'ArrowDown' });
    await fireEvent.keyDown(overlay, { key: 'ArrowDown' });
    expect(selectedName(container)).toBe('Project Plan');

    // A new query rebuilds `results`; the $effect must snap the selection
    // back to row 0 rather than leaving a stale out-of-range index.
    await type(getByPlaceholderText('Go to...'), 're');
    expect(selectedName(container)).toBe('Readme');
  });

  it('clicking a filtered row selects the CURRENT row, not a stale one', async () => {
    const onSelect = vi.fn();
    const { container, getByPlaceholderText } = renderDialog({ onSelect });
    const input = getByPlaceholderText('Go to...');

    // Filter down, then re-filter to a different single row before clicking —
    // exercises the onclick closure over the reactive `result` in the {#each}.
    await type(input, 'read');
    await type(input, 'recipes');

    const list = container.querySelector('.goto-results') as HTMLElement;
    expect(resultNames(list)).toEqual(['Recipes']);
    await fireEvent.click(within(list).getByText('Recipes'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('Recipes.md');
  });

  it('shows the "No matches" empty state when nothing scores', async () => {
    const { container, getByPlaceholderText, getByText } = renderDialog();
    await type(getByPlaceholderText('Go to...'), 'zzzqqq');

    expect(resultNames(container)).toEqual([]);
    expect(getByText('No matches')).toBeTruthy();
  });

  it('Escape cancels without selecting anything', async () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const { container } = renderDialog({ onSelect, onCancel });

    await fireEvent.keyDown(container.querySelector('.overlay')!, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
