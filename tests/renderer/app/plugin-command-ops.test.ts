/**
 * Running a plugin's command from the renderer (#2643): what it sends main,
 * and what it does with the answer — a replacement applied only to the text
 * still selected, an announcement shown, a skill / query / view run, and a
 * failure shown naming the plugin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  runCommand: vi.fn(),
  push: vi.fn(),
  commands: [{ pluginId: 'list-tools', pluginName: 'List Tools', command: { id: 'sort-selection', title: 'Sort List in Selection', when: 'selection', run: { handler: 'sortSelection' } } }],
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { plugins: { runCommand: h.runCommand } } }));
vi.mock('../../../src/renderer/lib/stores/toasts.svelte', () => ({ getToastStore: () => ({ push: h.push }) }));
vi.mock('../../../src/renderer/lib/stores/core-plugins.svelte', () => ({ corePluginsStore: { allCommands: () => h.commands } }));

import { createPluginCommandOps, type PluginCommandOpsCtx } from '../../../src/renderer/lib/app/plugin-command-ops';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins');

function setup(opts: { note?: string | null; selection?: { from: number; to: number; text: string } | null; replaced?: boolean } = {}) {
  const editor = {
    getSelectionRange: vi.fn(() => (opts.selection ? { from: opts.selection.from, to: opts.selection.to } : null)),
    getSelectedText: vi.fn(() => opts.selection?.text ?? ''),
    replaceRangeIfUnchanged: vi.fn(() => opts.replaced ?? true),
  };
  const ctx = {
    getEditorComponent: () => editor,
    getActiveNotePath: () => (opts.note === undefined ? 'list.md' : opts.note),
    runSkill: vi.fn(), openQuery: vi.fn(), openView: vi.fn(),
  } satisfies PluginCommandOpsCtx;
  return { editor, ctx, ops: createPluginCommandOps(ctx) };
}

beforeEach(() => { h.runCommand.mockReset(); h.push.mockReset(); });

describe('runPluginCommand (#2643)', () => {
  it('sends the note and selection, and replaces exactly the text it ran on', async () => {
    const { editor, ops } = setup({ selection: { from: 4, to: 12, text: '- b\n- a' } });
    h.runCommand.mockResolvedValue({ kind: 'result', replaceSelection: '- a\n- b' });
    await ops.runPluginCommand('list-tools', 'sort-selection');
    expect(h.runCommand).toHaveBeenCalledWith('list-tools', 'sort-selection', { note: 'list.md', selection: '- b\n- a' });
    expect(editor.replaceRangeIfUnchanged).toHaveBeenCalledWith(4, 12, '- b\n- a', '- a\n- b');
    expect(h.push).not.toHaveBeenCalled();
  });

  it("says so, and changes nothing, when the selection changed while it ran", async () => {
    const { ops } = setup({ selection: { from: 0, to: 3, text: 'abc' }, replaced: false });
    h.runCommand.mockResolvedValue({ kind: 'result', replaceSelection: 'cba', announce: 'Sorted.' });
    await ops.runPluginCommand('list-tools', 'sort-selection');
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith({ message: '"Sort List in Selection" didn\'t change the note: the selection changed while it ran.' });
  });

  it('shows an announcement, and sends no note or selection when there is none', async () => {
    const { ops } = setup({ note: null });
    h.runCommand.mockResolvedValue({ kind: 'result', announce: 'No list to sort in the selection.' });
    await ops.runPluginCommand('list-tools', 'sort-selection');
    expect(h.runCommand).toHaveBeenCalledWith('list-tools', 'sort-selection', {});
    expect(h.push).toHaveBeenCalledWith({ message: 'No list to sort in the selection.' });
  });

  it('runs a skill, opens a query or a view, as main says', async () => {
    const { ctx, ops } = setup();
    h.runCommand.mockResolvedValueOnce({ kind: 'skill', skill: 'steelman' })
      .mockResolvedValueOnce({ kind: 'query', text: 'SELECT 1' })
      .mockResolvedValueOnce({ kind: 'view', view: 'queue' });
    await ops.runPluginCommand('lab', 'a');
    await ops.runPluginCommand('lab', 'b');
    await ops.runPluginCommand('lab', 'c');
    expect(ctx.runSkill).toHaveBeenCalledWith('steelman');
    expect(ctx.openQuery).toHaveBeenCalledWith('SELECT 1');
    expect(ctx.openView).toHaveBeenCalledWith('lab', 'queue');
  });

  it("shows a failure as main worded it, without Electron's prefix", async () => {
    const { ops } = setup({ selection: { from: 0, to: 1, text: 'x' } });
    h.runCommand.mockRejectedValue(new Error("Error invoking remote method 'plugins:runCommand': PluginCallError: List Tools didn't answer \"sortSelection\" within 10s, so it was stopped."));
    await ops.runPluginCommand('list-tools', 'sort-selection');
    expect(h.push).toHaveBeenCalledWith({ message: 'List Tools didn\'t answer "sortSelection" within 10s, so it was stopped.' });
  });
});
