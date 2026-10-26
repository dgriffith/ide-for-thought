/**
 * @vitest-environment node
 *
 * Approving an agent-written plugin's proposal (#2890), with the real
 * installer on a temporary plugins folder: a declarative plugin installs as
 * the proposal's files; one with code asks natively first, and a "no"
 * installs nothing; an update writes only while the installed files are
 * still what was proposed against, and a hostile one that asks for more is
 * asked about as a change ("Now it can also …"); and an install is undone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useTempDir } from './../helpers/temp-project';
import { silenceLogTags } from './../helpers/quiet-logs';

const h = vi.hoisted(() => ({ dir: '', confirm: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));
vi.mock('../../src/main/native-confirm', () => ({ confirmNative: h.confirm }));
vi.mock('../../src/main/plugins-apply', () => ({ changePlugins: (op: () => Promise<unknown>) => op() }));
vi.mock('../../src/main/plugins/registry', async (orig) => ({
  ...(await orig<typeof import('../../src/main/plugins/registry')>()),
  activePluginsDir: () => h.dir,
  pluginsAppVersion: () => '4.0.0',
}));

import { pluginProposalApplierForApp } from '../../src/main/plugin-proposal-applier';
import { loadPluginRecords } from '../../src/main/plugins/state';
import { buildEscalatingDraftUpdate } from '../helpers/hostile-plugins';

silenceLogTags('plugins', 'config');

const tmp = useTempDir('plugin-proposal-applier-');
const SKILL = '---\nid: lab.weekly\nname: Weekly\ndescription: Review the week\nmenu: Analysis\noutputMode: openConversation\n---\nHelp.\n';
const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: 'lab', name: 'Lab', version: '0.1.0', minerva: '>=3.0.0', description: 'A lab.', contributes: { skills: ['skills/w.md'] }, ...extra });
const PLAIN = [{ path: 'plugin.json', content: manifest() }, { path: 'skills/w.md', content: SKILL }];
const code = (capabilities: string[], version = '0.1.0') => [
  { path: 'plugin.json', content: manifest({ version, code: { capabilities, api: '^1.0.0', worker: 'logic.js' } }) },
  { path: 'skills/w.md', content: SKILL },
  { path: 'logic.js', content: 'export {};\n' },
];
const read = (rel: string) => fs.readFileSync(path.join(h.dir, 'lab', rel), 'utf8');

beforeEach(() => {
  h.dir = path.join(tmp.root, '.minerva', 'plugins');
  fs.mkdirSync(h.dir, { recursive: true });
  h.confirm.mockReset();
});

describe('approving a drafted plugin (#2890)', () => {
  it('installs a declarative one as the proposal\'s files, asking nothing', async () => {
    await pluginProposalApplierForApp().install('lab', PLAIN);
    expect(read('plugin.json')).toBe(PLAIN[0]!.content);
    expect((await loadPluginRecords(h.dir)).lab).toMatchObject({ enabled: true, source: { kind: 'draft' } });
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it('asks natively before one with code goes in; a "no" installs nothing', async () => {
    h.confirm.mockResolvedValue({ confirmed: false, checked: false });
    await expect(pluginProposalApplierForApp().install('lab', code(['notes:read']))).rejects.toThrow("You didn't allow its code, so nothing was installed.");
    expect(fs.existsSync(path.join(h.dir, 'lab'))).toBe(false);
    h.confirm.mockResolvedValue({ confirmed: true, checked: false });
    await pluginProposalApplierForApp().install('lab', code(['notes:read']));
    expect((await loadPluginRecords(h.dir)).lab?.codeApproved?.capabilities).toEqual(['notes:read']);
  });

  it('refuses an install over one that is there, and an id its plugin.json doesn\'t name', async () => {
    await pluginProposalApplierForApp().install('lab', PLAIN);
    await expect(pluginProposalApplierForApp().install('lab', PLAIN)).rejects.toThrow('already installed');
    await expect(pluginProposalApplierForApp().install('other', [{ path: 'plugin.json', content: manifest({ id: 'other2' }) }, PLAIN[1]!]))
      .rejects.toThrow('names "other2", not "other"');
    expect(fs.existsSync(path.join(h.dir, 'other2'))).toBe(false);
  });

  it('undoes an install', async () => {
    await pluginProposalApplierForApp().install('lab', PLAIN);
    await pluginProposalApplierForApp().remove('lab');
    expect(fs.existsSync(path.join(h.dir, 'lab'))).toBe(false);
  });
});

describe('approving an edit (#2890)', () => {
  it('writes the new files while the installed ones are what it was proposed against', async () => {
    await pluginProposalApplierForApp().install('lab', PLAIN);
    const next = [{ path: 'plugin.json', content: manifest({ version: '0.2.0' }) }, PLAIN[1]!];
    await pluginProposalApplierForApp().update('lab', next, PLAIN);
    expect(read('plugin.json')).toBe(next[0]!.content);
  });

  it('writes nothing when the plugin changed since', async () => {
    await pluginProposalApplierForApp().install('lab', PLAIN);
    fs.writeFileSync(path.join(h.dir, 'lab', 'skills', 'w.md'), SKILL.replace('Help.', 'Edited by hand.'));
    await expect(pluginProposalApplierForApp().update('lab', code(['notes:read']), PLAIN)).rejects.toThrow('changed since this was proposed');
    expect(read('plugin.json')).toBe(PLAIN[0]!.content);
  });

  it('a hostile edit asking for more is asked about as a change, naming what it gains', async () => {
    const { before, files } = buildEscalatingDraftUpdate();
    h.confirm.mockResolvedValue({ confirmed: true, checked: false });
    await pluginProposalApplierForApp().install('lab', before);
    h.confirm.mockClear();
    h.confirm.mockResolvedValue({ confirmed: false, checked: false });
    await expect(pluginProposalApplierForApp().update('lab', files, before)).rejects.toThrow('nothing was written');
    const [, question] = h.confirm.mock.calls[0]!;
    expect(question.message).toBe('Lab changed since you allowed it. Allow it again?');
    expect(question.detail).toMatch(/Now it can also: create notes, and change the notes it was given; ask the assistant/);
    expect(read('plugin.json')).toBe(before[0]!.content);
  });
});
