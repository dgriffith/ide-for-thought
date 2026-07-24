/**
 * @vitest-environment happy-dom
 *
 * Render + rune-reactivity coverage for FileTree (#1002) — the recursive
 * left-sidebar file/folder tree. Focus is on the reactive surfaces:
 *   - the `active` class tracks the `activeFilePath` prop (a `$derived`-ish
 *     class binding) and moves when the prop changes,
 *   - folder children mount/unmount off the `expanded` map,
 *   - the `contextMenu` `$state` re-targets between opens so an action
 *     always reads the *currently* right-clicked node's path (guards the
 *     known Svelte 5 stale-`{@const}`/stale-state-on-click gotcha).
 *
 * The component pulls `api` from ../ipc/client for the context-menu
 * entrypoint probe + shell actions; we mock it so no real IPC fires.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { NoteFile } from '../../../src/shared/types';

// Hoisted api mock — FileTree reads api.notebase.readFile (entrypoint probe)
// and api.shell.* (Open In submenu). readFile resolves to empty content so the
// async entrypoint block after a right-click never rejects.
const h = vi.hoisted(() => ({
  api: {
    notebase: { readFile: vi.fn().mockResolvedValue('') },
    shell: {
      revealFile: vi.fn(),
      openInDefault: vi.fn(),
      openInTerminal: vi.fn(),
    },
  },
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import FileTree from '../../../src/renderer/lib/components/FileTree.svelte';

afterEach(cleanup);

/** notes/ (dir) → alpha.md, beta.md ; plus a root-level readme.md. */
function tree(): NoteFile[] {
  return [
    {
      name: 'notes',
      relativePath: 'notes',
      isDirectory: true,
      children: [
        { name: 'alpha.md', relativePath: 'notes/alpha.md', isDirectory: false },
        { name: 'beta.md', relativePath: 'notes/beta.md', isDirectory: false },
      ],
    },
    { name: 'readme.md', relativePath: 'readme.md', isDirectory: false },
  ];
}

type Props = Record<string, unknown>;

/** Full prop set with every callback stubbed; overridable per test. */
function props(over: Props = {}): Props {
  return {
    files: tree(),
    activeFilePath: null,
    expanded: {},
    selection: new Set<string>(),
    focusedPath: null,
    canPaste: false,
    onToggleDir: vi.fn(),
    onItemClick: vi.fn(),
    onNewNote: vi.fn(),
    onNewFolder: vi.fn(),
    onDelete: vi.fn(),
    onContextMenuTarget: vi.fn(),
    onRename: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onMove: vi.fn(),
    ...over,
  };
}

const row = (c: HTMLElement, path: string) =>
  c.querySelector<HTMLElement>(`[data-relative-path="${path}"]`);

describe('FileTree (#1002)', () => {
  it('renders a nested tree — folder + expanded children + root file', () => {
    const { container, getByText } = render(
      FileTree,
      props({ expanded: { notes: true } }),
    );
    // Folder label is raw; file labels strip the .md extension.
    expect(getByText('notes')).toBeTruthy();
    expect(getByText('alpha')).toBeTruthy();
    expect(getByText('beta')).toBeTruthy();
    expect(getByText('readme')).toBeTruthy();

    // Children live one depth deeper than the folder row.
    expect(row(container, 'notes')).toBeTruthy();
    expect(row(container, 'notes/alpha.md')).toBeTruthy();
    expect(row(container, 'readme.md')).toBeTruthy();
  });

  it('marks the active file and moves the highlight when activeFilePath changes', async () => {
    const { container, rerender } = render(
      FileTree,
      props({ expanded: { notes: true }, activeFilePath: 'notes/alpha.md' }),
    );
    expect(row(container, 'notes/alpha.md')!.classList.contains('active')).toBe(true);
    expect(row(container, 'notes/beta.md')!.classList.contains('active')).toBe(false);

    // Rerender with a new active file: the old row must lose `active`, the
    // new one gain it — a stale class binding would keep alpha lit.
    await rerender(props({ expanded: { notes: true }, activeFilePath: 'notes/beta.md' }));
    expect(row(container, 'notes/alpha.md')!.classList.contains('active')).toBe(false);
    expect(row(container, 'notes/beta.md')!.classList.contains('active')).toBe(true);
  });

  it('reflects the selection set on the matching rows and updates on rerender', async () => {
    const { container, rerender } = render(
      FileTree,
      props({ expanded: { notes: true }, selection: new Set(['notes/alpha.md']) }),
    );
    expect(row(container, 'notes/alpha.md')!.classList.contains('selected')).toBe(true);
    expect(row(container, 'readme.md')!.classList.contains('selected')).toBe(false);

    await rerender(props({ expanded: { notes: true }, selection: new Set(['readme.md']) }));
    expect(row(container, 'notes/alpha.md')!.classList.contains('selected')).toBe(false);
    expect(row(container, 'readme.md')!.classList.contains('selected')).toBe(true);
  });

  it('mounts/unmounts folder children off the expanded map', async () => {
    const { container, rerender } = render(FileTree, props({ expanded: {} }));
    // Collapsed: the folder row exists but its children are not rendered.
    expect(row(container, 'notes')).toBeTruthy();
    expect(row(container, 'notes/alpha.md')).toBeNull();

    await rerender(props({ expanded: { notes: true } }));
    expect(row(container, 'notes/alpha.md')).toBeTruthy();
    expect(row(container, 'notes/beta.md')).toBeTruthy();
  });

  it('clicking the disclosure chevron fires onToggleDir with the folder path', async () => {
    const onToggleDir = vi.fn();
    const { getByLabelText } = render(FileTree, props({ onToggleDir }));
    // Collapsed folder → chevron carries the "Expand folder" label.
    await fireEvent.click(getByLabelText('Expand folder'));
    expect(onToggleDir).toHaveBeenCalledWith('notes');
  });

  it('plain-clicking a collapsed folder row opens it and selects it', async () => {
    const onToggleDir = vi.fn();
    const onItemClick = vi.fn();
    const { container } = render(
      FileTree,
      props({ expanded: {}, onToggleDir, onItemClick }),
    );
    // Click the row body (not the chevron) of the collapsed `notes` folder.
    await fireEvent.click(row(container, 'notes')!);
    // Selects…
    expect(onItemClick).toHaveBeenCalledWith('notes', true, { shift: false, meta: false });
    // …and opens.
    expect(onToggleDir).toHaveBeenCalledWith('notes');
  });

  it('plain-clicking an already-open folder row selects but does NOT collapse it', async () => {
    const onToggleDir = vi.fn();
    const onItemClick = vi.fn();
    const { container } = render(
      FileTree,
      props({ expanded: { notes: true }, onToggleDir, onItemClick }),
    );
    await fireEvent.click(row(container, 'notes')!);
    expect(onItemClick).toHaveBeenCalledWith('notes', true, { shift: false, meta: false });
    // Closing stays chevron-only — a row click must not toggle it shut.
    expect(onToggleDir).not.toHaveBeenCalled();
  });

  it('shift/⌘-clicking a collapsed folder row selects but does NOT open it', async () => {
    const onToggleDir = vi.fn();
    const onItemClick = vi.fn();
    const { container } = render(
      FileTree,
      props({ expanded: {}, onToggleDir, onItemClick }),
    );
    await fireEvent.click(row(container, 'notes')!, { shiftKey: true });
    expect(onItemClick).toHaveBeenCalledWith('notes', true, { shift: true, meta: false });
    expect(onToggleDir).not.toHaveBeenCalled();

    onItemClick.mockClear();
    await fireEvent.click(row(container, 'notes')!, { metaKey: true });
    expect(onItemClick).toHaveBeenCalledWith('notes', true, { shift: false, meta: true });
    expect(onToggleDir).not.toHaveBeenCalled();
  });

  it('clicking the chevron on a collapsed folder toggles without double-firing', async () => {
    const onToggleDir = vi.fn();
    const onItemClick = vi.fn();
    const { getByLabelText } = render(
      FileTree,
      props({ expanded: {}, onToggleDir, onItemClick }),
    );
    // The chevron branch returns early: it toggles once and never selects.
    await fireEvent.click(getByLabelText('Expand folder'));
    expect(onToggleDir).toHaveBeenCalledTimes(1);
    expect(onToggleDir).toHaveBeenCalledWith('notes');
    expect(onItemClick).not.toHaveBeenCalled();
  });

  it('clicking a file row fires onItemClick with its path and modifier flags', async () => {
    const onItemClick = vi.fn();
    const { container } = render(
      FileTree,
      props({ expanded: { notes: true }, onItemClick }),
    );
    await fireEvent.click(row(container, 'notes/alpha.md')!);
    expect(onItemClick).toHaveBeenCalledWith(
      'notes/alpha.md',
      false,
      { shift: false, meta: false },
    );
  });

  it('right-clicking a file opens the context menu with item actions', async () => {
    const onContextMenuTarget = vi.fn();
    const { container, getByText } = render(
      FileTree,
      props({ expanded: { notes: true }, onContextMenuTarget }),
    );
    await fireEvent.contextMenu(row(container, 'notes/alpha.md')!);
    // The right-clicked item is promoted into the selection first…
    expect(onContextMenuTarget).toHaveBeenCalledWith('notes/alpha.md');
    // …then the menu renders its target-scoped actions.
    expect(getByText('Rename')).toBeTruthy();
    expect(getByText('Delete')).toBeTruthy();
    expect(getByText('Copy Path')).toBeTruthy();
  });

  it('context-menu actions read the currently right-clicked node across reopens', async () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const { container, getByText } = render(
      FileTree,
      props({ expanded: { notes: true }, onRename, onDelete }),
    );

    // Open on alpha, invoke Rename → must carry alpha's path.
    await fireEvent.contextMenu(row(container, 'notes/alpha.md')!);
    await fireEvent.click(getByText('Rename'));
    expect(onRename).toHaveBeenCalledWith('notes/alpha.md');

    // Reopen on beta, invoke Delete → must carry beta's path, not alpha's.
    // A stale `contextMenu` target (the known Svelte 5 gotcha) would fire
    // with 'notes/alpha.md' here.
    await fireEvent.contextMenu(row(container, 'notes/beta.md')!);
    await fireEvent.click(getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith('notes/beta.md', false);
  });
});
