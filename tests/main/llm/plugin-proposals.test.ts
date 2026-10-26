/**
 * @vitest-environment node
 *
 * Plugins an agent writes (#2890), through the real tool and the real
 * approval engine: a drafted plugin is filed as a PENDING `plugin_install`
 * proposal and nothing reaches the plugins folder; only approving it calls
 * the installer; with no installer wired (the CLI) an approval fails and the
 * proposal stays pending; an installed plugin's edit is a `plugin_update`
 * against its files as they were; one pending proposal per plugin; and a
 * built-in id, or an installed folder no draft could have made, is refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useGraphProject } from '../../helpers/temp-project';
import { silenceLogTags } from '../../helpers/quiet-logs';

const h = vi.hoisted(() => ({ dir: '' }));
vi.mock('../../../src/main/skills/loader', () => ({ getSkillCatalog: async () => ({ skills: [], errors: [] }) }));
vi.mock('../../../src/main/plugins/registry', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/plugins/registry')>()),
  pluginsAppVersion: () => '4.0.0',
  activePluginsDir: () => h.dir,
}));

import { offerExtensionDraft } from '../../../src/main/llm/tools/offer-extension-draft';
import { approveProposal, listProposals } from '../../../src/main/llm/approval';
import { setPluginProposalApplier, type PluginProposalApplier } from '../../../src/main/llm/plugin-proposals';

silenceLogTags('approval');

const project = useGraphProject('minerva-plugin-proposals-');
const SKILL = '---\nid: lab.weekly\nname: Weekly\ndescription: Review the week\nmenu: Analysis\noutputMode: openConversation\n---\nHelp me review my week.\n';
const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: 'lab', name: 'Lab', version: '0.1.0', minerva: '>=3.0.0', description: 'A lab.', contributes: { skills: ['skills/w.md'] }, ...extra });
const DRAFT = { kind: 'plugin', summary: 'A weekly review.', files: [{ path: 'plugin.json', content: manifest() }, { path: 'skills/w.md', content: SKILL }] };
const offerCard = vi.fn();

function applier(): PluginProposalApplier & { [k: string]: ReturnType<typeof vi.fn> } {
  return { install: vi.fn(async () => {}), update: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
}
const run = (input: unknown) => offerExtensionDraft.run({ rootPath: project.root, conversationId: 'c1' }, input, { offerExtensionDraft: offerCard });

beforeEach(() => {
  h.dir = path.join(project.root, 'machine', 'plugins');
  fs.mkdirSync(h.dir, { recursive: true });
  offerCard.mockReset();
});
afterEach(() => setPluginProposalApplier(null));

describe('a drafted plugin is a proposal (#2890)', () => {
  it('is filed pending, installs nothing, and shows no card', async () => {
    const a = applier();
    setPluginProposalApplier(a);
    const r = await run(DRAFT);
    expect(r).toEqual({ isError: false, content: expect.stringMatching(/^Filed as a PENDING proposal to install the Lab plugin\. Nothing is installed yet/) });
    expect(offerCard).not.toHaveBeenCalled();
    expect(fs.readdirSync(h.dir)).toEqual([]);
    expect(a.install).not.toHaveBeenCalled();
    const [p] = await listProposals(project.ctx, 'pending');
    expect(p).toMatchObject({ operationType: 'plugin_install', proposedBy: 'llm:conversation:c1', note: 'Install the Lab plugin: A weekly review.' });
    expect(p!.payloads).toEqual([{ kind: 'plugin-install', id: 'lab', name: 'Lab', files: DRAFT.files }]);
  });

  it('only approving it installs it, from the proposal\'s files', async () => {
    const a = applier();
    setPluginProposalApplier(a);
    await run(DRAFT);
    const [p] = await listProposals(project.ctx, 'pending');
    await approveProposal(project.ctx, p!.uri);
    expect(a.install).toHaveBeenCalledWith('lab', DRAFT.files);
    expect((await listProposals(project.ctx, 'approved')).map((x) => x.uri)).toEqual([p!.uri]);
  });

  it('with no installer wired, approving fails and it stays pending', async () => {
    await run(DRAFT);
    const [p] = await listProposals(project.ctx, 'pending');
    await expect(approveProposal(project.ctx, p!.uri)).rejects.toThrow('Plugins can only be installed from a proposal in the Minerva app.');
    expect((await listProposals(project.ctx, 'pending')).map((x) => x.uri)).toEqual([p!.uri]);
  });

  it('a "no" to its code leaves it pending', async () => {
    const a = applier();
    a.install.mockRejectedValue(new Error("You didn't allow its code, so nothing was installed. The proposal is still pending."));
    setPluginProposalApplier(a);
    await run(DRAFT);
    const [p] = await listProposals(project.ctx, 'pending');
    await expect(approveProposal(project.ctx, p!.uri)).rejects.toThrow("didn't allow its code");
    expect(await listProposals(project.ctx, 'pending')).toHaveLength(1);
  });

  it('is filed once: a second draft of the same plugin says the first is waiting', async () => {
    await run(DRAFT);
    expect(await run(DRAFT)).toMatchObject({ isError: true, content: expect.stringContaining('already pending') });
    expect(await listProposals(project.ctx, 'pending')).toHaveLength(1);
  });
});

describe('an edit to an installed plugin (#2890)', () => {
  it('is a plugin_update against the installed files, approved through the installer', async () => {
    fs.mkdirSync(path.join(h.dir, 'lab', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(h.dir, 'lab', 'plugin.json'), manifest());
    fs.writeFileSync(path.join(h.dir, 'lab', 'skills', 'w.md'), SKILL);
    const a = applier();
    setPluginProposalApplier(a);
    const edited = { ...DRAFT, files: [{ path: 'plugin.json', content: manifest({ version: '0.2.0' }) }, DRAFT.files[1]!] };
    expect((await run(edited)).content).toMatch(/^Filed as a PENDING proposal to change the installed Lab plugin/);
    const [p] = await listProposals(project.ctx, 'pending');
    expect(p!.operationType).toBe('plugin_update');
    expect(p!.payloads).toEqual([{ kind: 'plugin-update', id: 'lab', name: 'Lab', files: edited.files, before: [{ path: 'plugin.json', content: manifest() }, { path: 'skills/w.md', content: SKILL }] }]);
    expect(fs.readFileSync(path.join(h.dir, 'lab', 'plugin.json'), 'utf8')).toBe(manifest());
    await approveProposal(project.ctx, p!.uri);
    expect(a.update).toHaveBeenCalledWith('lab', edited.files, p!.payloads[0] && (p!.payloads[0] as { before: unknown }).before);
  });

  it('refuses a folder no draft could have made, and a built-in plugin\'s id', async () => {
    fs.mkdirSync(path.join(h.dir, 'lab'), { recursive: true });
    fs.writeFileSync(path.join(h.dir, 'lab', 'plugin.json'), manifest());
    fs.writeFileSync(path.join(h.dir, 'lab', 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff]));
    expect(await run(DRAFT)).toMatchObject({ isError: true, content: expect.stringContaining("isn't one a draft can change") });
    const kanban = { ...DRAFT, files: [{ path: 'plugin.json', content: manifest({ id: 'kanban' }) }, DRAFT.files[1]!] };
    const r = await run(kanban);
    expect(r.isError).toBe(true);
    expect(await listProposals(project.ctx, 'pending')).toEqual([]);
  });
});
