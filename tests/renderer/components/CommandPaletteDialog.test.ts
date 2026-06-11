/**
 * @vitest-environment happy-dom
 *
 * Component-interaction coverage for the command palette (#680, QA Q-H4).
 *
 * Renders the real CommandPaletteDialog and drives it the way a user does —
 * type to filter, arrow to move, Enter / click to run, Escape to close —
 * asserting the selected command's run() fires and the dialog closes. The
 * fuzzy scoring (scoreCommand) runs for real; only the localStorage-backed
 * recent list is stubbed so results are deterministic.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

const { recordRecentMock } = vi.hoisted(() => ({ recordRecentMock: vi.fn() }));
vi.mock('../../../src/renderer/lib/command-palette/recent', () => ({
  loadRecent: () => [] as string[],
  recordRecent: recordRecentMock,
}));

import CommandPaletteDialog from '../../../src/renderer/lib/components/CommandPaletteDialog.svelte';

function makeCommands() {
  return [
    { id: 'settings', title: 'Open Settings', category: 'App', enabled: true, run: vi.fn() },
    { id: 'daily', title: 'Create Daily Note', category: 'File', enabled: true, run: vi.fn() },
    { id: 'bold', title: 'Toggle Bold', category: 'Format', enabled: false, run: vi.fn() },
  ];
}

afterEach(() => {
  cleanup();
  recordRecentMock.mockReset();
});

describe('CommandPaletteDialog (#680)', () => {
  it('lists every command (alphabetical) when the query is empty', () => {
    const { getByText } = render(CommandPaletteDialog, { commands: makeCommands(), onClose: vi.fn() });
    expect(getByText('Open Settings')).toBeTruthy();
    expect(getByText('Create Daily Note')).toBeTruthy();
    expect(getByText('Toggle Bold')).toBeTruthy();
  });

  it('typing filters to fuzzy matches', async () => {
    const { getByRole, getByText, queryByText } = render(
      CommandPaletteDialog, { commands: makeCommands(), onClose: vi.fn() },
    );
    await fireEvent.input(getByRole('textbox'), { target: { value: 'settings' } });
    expect(getByText('Open Settings')).toBeTruthy();
    expect(queryByText('Create Daily Note')).toBeNull();
  });

  it('Enter runs the selected command, records it as recent, and closes', async () => {
    const commands = makeCommands();
    const onClose = vi.fn();
    const { container } = render(CommandPaletteDialog, { commands, onClose });

    // Empty query → alphabetical: "Create Daily Note" is row 0 (selected).
    const overlay = container.querySelector('.overlay')!;
    await fireEvent.keyDown(overlay, { key: 'Enter' });

    expect(commands.find((c) => c.id === 'daily')!.run).toHaveBeenCalledTimes(1);
    expect(recordRecentMock).toHaveBeenCalledWith('daily');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowDown then Enter runs the next command down', async () => {
    const commands = makeCommands();
    const { container } = render(CommandPaletteDialog, { commands, onClose: vi.fn() });
    const overlay = container.querySelector('.overlay')!;

    await fireEvent.keyDown(overlay, { key: 'ArrowDown' }); // row 0 → row 1 ("Open Settings")
    await fireEvent.keyDown(overlay, { key: 'Enter' });

    expect(commands.find((c) => c.id === 'settings')!.run).toHaveBeenCalledTimes(1);
    expect(commands.find((c) => c.id === 'daily')!.run).not.toHaveBeenCalled();
  });

  it('clicking a result runs that command', async () => {
    const commands = makeCommands();
    const onClose = vi.fn();
    const { getByText } = render(CommandPaletteDialog, { commands, onClose });

    await fireEvent.click(getByText('Open Settings'));

    expect(commands.find((c) => c.id === 'settings')!.run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a disabled command does not run when clicked', async () => {
    const commands = makeCommands();
    const { getByText } = render(CommandPaletteDialog, { commands, onClose: vi.fn() });

    await fireEvent.click(getByText('Toggle Bold'));

    expect(commands.find((c) => c.id === 'bold')!.run).not.toHaveBeenCalled();
  });

  it('Escape closes without running anything', async () => {
    const commands = makeCommands();
    const onClose = vi.fn();
    const { container } = render(CommandPaletteDialog, { commands, onClose });
    const overlay = container.querySelector('.overlay')!;

    await fireEvent.keyDown(overlay, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    for (const c of commands) expect(c.run).not.toHaveBeenCalled();
  });

  it('shows a no-match message when nothing scores', async () => {
    const { getByRole, getByText } = render(
      CommandPaletteDialog, { commands: makeCommands(), onClose: vi.fn() },
    );
    await fireEvent.input(getByRole('textbox'), { target: { value: 'zzzzqqq' } });
    expect(getByText(/No commands match/)).toBeTruthy();
  });
});
