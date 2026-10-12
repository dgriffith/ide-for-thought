/**
 * The whole menu bar, pinned (#2625). Every item's label, accelerator,
 * enablement (with no thoughtbase open, and with one open, a note active and
 * text selected), and what a click does — the channel and payload it sends, or
 * the lifecycle function it calls. Taken before the menu moved onto the command
 * registry, so a refactor that changes any of it shows up as a snapshot diff.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import os from 'node:os';

const h = vi.hoisted(() => ({
  calls: [] as string[],
  rootPath: null as string | null,
}));

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: () => undefined },
  BrowserWindow: {
    getFocusedWindow: () => ({ id: 1, webContents: { send: (ch: string, ...a: unknown[]) => h.calls.push(`send ${ch}${a.length ? ` ${JSON.stringify(a)}` : ''}`) } }),
    getAllWindows: () => [],
    fromId: () => null,
  },
  shell: { openExternal: (u: string) => { h.calls.push(`openExternal ${u}`); return Promise.resolve(); } },
  dialog: { showSaveDialog: async () => { h.calls.push('showSaveDialog'); return { canceled: true }; } },
  app: { getPath: () => os.tmpdir(), getName: () => 'Minerva' },
}));
vi.mock('../../../src/main/recent-projects', () => ({
  getRecentProjects: () => ['/projects/alpha'],
  clearRecentProjects: () => undefined,
}));
vi.mock('../../../src/main/project-config', () => ({ resolveDisplayName: (p: string) => p.split('/').pop() }));
vi.mock('../../../src/main/window-manager', () => ({
  createWindow: () => { h.calls.push('createWindow'); return { webContents: { once: () => undefined, send: () => undefined } }; },
  openProjectInWindow: async (...a: unknown[]) => { h.calls.push(`openProjectInWindow ${JSON.stringify(a.slice(1))}`); },
  getRootPath: () => h.rootPath,
  broadcastBackfillProgress: () => undefined,
  broadcastMaintenanceProgress: () => undefined,
}));
vi.mock('../../../src/main/maintenance-commands', () => ({
  rebuildAllIndexes: async () => { h.calls.push('rebuildAllIndexes'); },
  rebuildSemanticIndex: async () => { h.calls.push('rebuildSemanticIndex'); },
  interruptCell: async () => { h.calls.push('interruptCell'); },
  restartKernel: async () => { h.calls.push('restartKernel'); },
  exportKnowledgeGraph: async () => { h.calls.push('exportKnowledgeGraph'); },
}));
vi.mock('../../../src/main/cli-install', () => ({ installMinervaCommand: async () => { h.calls.push('installMinervaCommand'); } }));
vi.mock('../../../src/main/auto-update', () => ({
  checkForUpdatesNow: () => { h.calls.push('checkForUpdatesNow'); },
  isUpdateDownloaded: () => false,
  quitAndInstallUpdate: () => { h.calls.push('quitAndInstallUpdate'); },
  getUpdateState: () => ({ status: 'idle' }),
}));
vi.mock('../../../src/main/saved-queries', () => ({
  listSavedQueries: () => [{ name: 'Open questions', language: 'sparql', query: 'SELECT 1', scope: 'project', filePath: 'q.rq' }],
}));
vi.mock('../../../src/main/publish', () => ({
  listExporters: () => [{ id: 'pdf', label: 'PDF', group: 'document', accepts: ['note'] }],
  listExportGroups: () => [
    { group: { id: 'pdf', label: 'PDF', category: 'document' } },
    { group: { id: 'site', label: 'Static Site', category: 'publication' } },
  ],
}));

import { rebuildMenu, setMenuEditorState } from '../../../src/main/menu';
import { registerTool } from '../../../src/shared/tools/registry';

type Item = Electron.MenuItemConstructorOptions;

/** One line per item: indent, label/role/type, accelerator, enablement, effect. */
async function describeMenu(template: Item[], depth = 0): Promise<string[]> {
  const out: string[] = [];
  for (const item of template) {
    const pad = '  '.repeat(depth);
    if (item.type === 'separator') { out.push(`${pad}---`); continue; }
    const name = item.label ?? `(role ${item.role})`;
    const bits = [
      item.accelerator ? `[${String(item.accelerator)}]` : '',
      item.enabled === false ? 'disabled' : '',
      item.type && item.type !== 'normal' && item.type !== 'submenu' ? item.type : '',
      item.checked ? 'checked' : '',
      item.role && item.label ? `role=${item.role}` : '',
    ].filter(Boolean);
    let effect = '';
    if (item.click) {
      h.calls = [];
      try {
        await (item.click as unknown as () => unknown)();
      } catch (e) { h.calls.push(`threw ${(e as Error).message}`); }
      await new Promise((r) => setTimeout(r, 0));
      effect = h.calls.length ? ` → ${h.calls.join('; ')}` : ' → (no effect)';
    }
    out.push(`${pad}${name}${bits.length ? ` ${bits.join(' ')}` : ''}${effect}`);
    if (Array.isArray(item.submenu)) out.push(...await describeMenu(item.submenu, depth + 1));
  }
  return out;
}

describe('the menu bar (#2625)', () => {
  const platform = process.platform;
  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const base = { description: 'd', longDescription: 'l', context: [], outputMode: 'openConversation' } as const;
    registerTool({ ...base, id: 'snap.ask', name: 'Snapshot Ask', category: 'learning' });
    registerTool({ ...base, id: 'snap.grouped', name: 'Snapshot Grouped', category: 'research', group: 'Reading' });
    registerTool({ ...base, id: 'snap.selection', name: 'Snapshot Selection', category: 'analysis', requiresSelection: true });
    registerTool({ ...base, id: 'snap.source', name: 'Snapshot Source', category: 'research', scope: 'source' });
    return () => { Object.defineProperty(process, 'platform', { value: platform }); };
  });

  it('with no thoughtbase open', async () => {
    h.rootPath = null;
    expect((await describeMenu(rebuildMenu())).join('\n')).toMatchSnapshot();
  });

  it('with a thoughtbase open, a note active and text selected', async () => {
    h.rootPath = '/projects/alpha';
    setMenuEditorState(1, { hasEditor: true, hasNote: true, hasSelection: true });
    expect((await describeMenu(rebuildMenu())).join('\n')).toMatchSnapshot();
  });
});
