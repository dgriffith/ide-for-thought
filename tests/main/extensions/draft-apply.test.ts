/**
 * @vitest-environment node
 *
 * What happens when the user saves a drafted extension (#2652): a skill goes
 * into the skills folder through the same import Settings uses, a plugin is
 * installed through the same checked install (recorded as a draft), and
 * either can be written into a folder the user picked. Nothing is ever
 * written over something that's there, or outside the folder it's meant for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({ dialog: {}, shell: {} }));

import { saveDraftToFolder, saveSkillDraft } from '../../../src/main/extensions/draft-apply';
import type { CheckedExtensionDraft } from '../../../src/main/extensions/draft-check';
import { writeDraftFiles } from '../../../src/main/plugins/draft-files';
import { installPluginFromDraft } from '../../../src/main/plugins/lifecycle';
import { loadPluginRecords } from '../../../src/main/plugins/state';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins');

const SKILL = '---\nid: my.weekly\nname: Weekly Review\ndescription: Review the week\nmenu: Analysis\noutputMode: openConversation\n---\nHelp me review my week.\n';
const skillDraft = (p: string): CheckedExtensionDraft => ({ kind: 'skill', id: 'my.weekly', name: 'Weekly Review', summary: 's', files: [{ path: p, content: SKILL }] });
const MANIFEST = JSON.stringify({
  id: 'lab', name: 'Lab', version: '0.1.0', minerva: '>=3.0.0', description: 'A lab.',
  contributes: { skills: ['skills/hello.md'] },
});
const PLUGIN_FILES = [
  { path: 'plugin.json', content: MANIFEST },
  { path: 'skills/hello.md', content: SKILL.replace('my.weekly', 'lab.hello') },
];
const pluginDraft: CheckedExtensionDraft = { kind: 'plugin', id: 'lab', name: 'Lab', summary: 's', files: PLUGIN_FILES };

let tmp: string;
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-draft-apply-'))); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('saveSkillDraft (#2652)', () => {
  it.each([
    ['a single file', 'weekly.md', 'weekly.md'],
    ['a SKILL.md folder', 'weekly/SKILL.md', 'weekly/SKILL.md'],
  ])('saves %s into the skills folder', async (_what, p, written) => {
    const dir = path.join(tmp, 'skills');
    expect(await saveSkillDraft(skillDraft(p), dir)).toBe(path.join(dir, p.split('/')[0]!));
    expect(fs.readFileSync(path.join(dir, written), 'utf-8')).toBe(SKILL);
  });

  it('won\'t save over a skill that\'s there, or one with the same id', async () => {
    const dir = path.join(tmp, 'skills');
    await saveSkillDraft(skillDraft('weekly.md'), dir);
    await expect(saveSkillDraft(skillDraft('weekly.md'), dir)).rejects.toThrow(/already have a skill with the id "my\.weekly"/);
    await expect(saveSkillDraft(skillDraft('other.md'), dir)).rejects.toThrow(/already have a skill/);
    expect(fs.readdirSync(dir)).toEqual(['weekly.md']);
  });

  it('only saves a skill', async () => {
    await expect(saveSkillDraft(pluginDraft, tmp)).rejects.toThrow(/Only a skill/);
  });
});

describe('saveDraftToFolder (#2652)', () => {
  it('writes a plugin as <folder>/<id>/, a skill as its file or folder', async () => {
    expect(await saveDraftToFolder(pluginDraft, tmp)).toBe(path.join(tmp, 'lab'));
    expect(fs.readFileSync(path.join(tmp, 'lab', 'skills', 'hello.md'), 'utf-8')).toContain('lab.hello');
    expect(await saveDraftToFolder(skillDraft('weekly.md'), tmp)).toBe(path.join(tmp, 'weekly.md'));
    expect(await saveDraftToFolder(skillDraft('folder/SKILL.md'), tmp)).toBe(path.join(tmp, 'folder'));
    expect(fs.readFileSync(path.join(tmp, 'folder', 'SKILL.md'), 'utf-8')).toBe(SKILL);
  });

  it('never writes over what\'s there', async () => {
    fs.mkdirSync(path.join(tmp, 'lab'));
    fs.writeFileSync(path.join(tmp, 'weekly.md'), 'mine');
    await expect(saveDraftToFolder(pluginDraft, tmp)).rejects.toThrow(/lab already exists/);
    await expect(saveDraftToFolder(skillDraft('weekly.md'), tmp)).rejects.toThrow(/weekly\.md already exists/);
    expect(fs.readFileSync(path.join(tmp, 'weekly.md'), 'utf-8')).toBe('mine');
    expect(fs.readdirSync(path.join(tmp, 'lab'))).toEqual([]);
  });
});

describe('writeDraftFiles (#2652)', () => {
  it('checks every path again, before writing anything', async () => {
    await expect(writeDraftFiles(path.join(tmp, 'x'), [{ path: 'ok.txt', content: '' }, { path: '../escape.txt', content: '' }])).rejects.toThrow(/plain names/);
    expect(fs.existsSync(path.join(tmp, 'x'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'escape.txt'))).toBe(false);
  });
});

describe('installPluginFromDraft (#2652)', () => {
  it('installs it checked whole, recorded as a draft', async () => {
    const dir = path.join(tmp, 'plugins');
    const installed = await installPluginFromDraft(dir, PLUGIN_FILES, '4.0.0');
    expect(installed?.manifest.id).toBe('lab');
    expect(fs.readFileSync(path.join(dir, 'lab', 'skills', 'hello.md'), 'utf-8')).toContain('lab.hello');
    expect((await loadPluginRecords(dir)).lab).toMatchObject({ enabled: true, source: { kind: 'draft' } });
    // The staging is gone.
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('.install-'))).toEqual([]);
  });

  it('refuses a draft the full check refuses, leaving nothing behind', async () => {
    const dir = path.join(tmp, 'plugins');
    const files = [{ path: 'plugin.json', content: MANIFEST.replace('skills/hello.md', 'types/hello.md') }, { path: 'types/hello.md', content: 'not a type' }];
    await expect(installPluginFromDraft(dir, files, '4.0.0')).rejects.toThrow(/can't be installed/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('asks before replacing an installed plugin of that id', async () => {
    const dir = path.join(tmp, 'plugins');
    await installPluginFromDraft(dir, PLUGIN_FILES, '4.0.0');
    const asked: string[] = [];
    expect(await installPluginFromDraft(dir, PLUGIN_FILES, '4.0.0', { replace: async (id) => { asked.push(id); return false; } })).toBeNull();
    expect(asked).toEqual(['lab']);
  });
});
