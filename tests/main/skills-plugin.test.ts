/**
 * @vitest-environment node
 *
 * Plugin skills (#2633): loaded after stock and user, under their own ids,
 * stamped with their plugin — and never in place of a stock or user skill,
 * another plugin's, or a slash command already taken.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';
import { readPluginPackages } from '../../src/main/plugins/package';
import { writePlugin, skillFile } from '../helpers/plugins';

let pluginsDir: string;
let userDir: string;
beforeEach(() => {
  pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-skills-'));
  userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-user-skills-'));
});
afterEach(() => {
  for (const d of [pluginsDir, userDir]) fs.rmSync(d, { recursive: true, force: true });
});

const catalog = async () => loadSkillCatalog(userDir, await readPluginPackages('4.0.0', pluginsDir));

describe('plugin skills (#2633)', () => {
  it('load as source "plugin", keeping their own id and carrying their plugin', async () => {
    writePlugin(pluginsDir, 'lab', { skills: ['skills/a.md', 'skills/folder'] }, {
      'skills/a.md': skillFile('lab.summarize', 'Lab Summary', 'slashCommand: labsum\n'),
      'skills/folder/SKILL.md': skillFile('lab.review', 'Lab Review'),
    }, { name: 'Lab Tools' });
    const { skills, errors } = await catalog();
    expect(errors).toEqual([]);
    const mine = skills.filter((s) => s.source === 'plugin');
    expect(mine.map((s) => [s.id, s.name, s.slashCommand, s.plugin])).toEqual([
      ['lab.summarize', 'Lab Summary', '/labsum', { id: 'lab', name: 'Lab Tools', version: '1.0.0' }],
      ['lab.review', 'Lab Review', undefined, { id: 'lab', name: 'Lab Tools', version: '1.0.0' }],
    ]);
  });

  it('can\'t replace a stock or user skill, or an earlier plugin\'s — the clash is reported against the plugin', async () => {
    fs.writeFileSync(path.join(userDir, 'mine.md'), skillFile('my.skill', 'Mine'));
    writePlugin(pluginsDir, 'a-first', { skills: ['skills/x.md'] }, { 'skills/x.md': skillFile('shared.id', 'From A') });
    writePlugin(pluginsDir, 'b-second', { skills: ['skills/stock.md', 'skills/user.md', 'skills/x.md'] }, {
      'skills/stock.md': skillFile('learning.give-examples', 'Fake Examples'),
      'skills/user.md': skillFile('my.skill', 'Fake Mine'),
      'skills/x.md': skillFile('shared.id', 'From B'),
    });
    const { skills, errors } = await catalog();
    expect(skills.find((s) => s.id === 'learning.give-examples')?.source).toBe('stock');
    expect(skills.find((s) => s.id === 'my.skill')?.source).toBe('user');
    expect(skills.find((s) => s.id === 'shared.id')?.plugin?.id).toBe('a-first');
    expect(errors.map((e) => [e.source, e.label, e.message])).toEqual([
      ['plugin', 'b-second: Fake Examples', 'id "learning.give-examples" is already a stock skill; a plugin can\'t replace it'],
      ['plugin', 'b-second: Fake Mine', 'id "my.skill" is already a user skill; a plugin can\'t replace it'],
      ['plugin', 'b-second: From B', 'id "shared.id" is already the a-first plugin\'s skill; a plugin can\'t replace it'],
    ]);
  });

  it('can\'t take a slash command already in use', async () => {
    writePlugin(pluginsDir, 'lab', { skills: ['skills/a.md'] }, {
      'skills/a.md': skillFile('lab.examples', 'Lab Examples', 'slashCommand: /examples\n'),
    });
    const { skills, errors } = await catalog();
    expect(skills.some((s) => s.id === 'lab.examples')).toBe(false);
    expect(errors).toEqual([expect.objectContaining({
      source: 'plugin', label: 'lab: Lab Examples', message: 'slash command /examples is already "Give Examples"\'s; a plugin can\'t take it',
    })]);
  });

  it('a skill that doesn\'t parse is reported against its plugin, and the plugin\'s others still load', async () => {
    writePlugin(pluginsDir, 'lab', { skills: ['skills/bad.md', 'skills/good.md'] }, {
      'skills/bad.md': '---\nname: [unclosed\n---\n',
      'skills/good.md': skillFile('lab.good', 'Good'),
    });
    const { skills, errors } = await catalog();
    expect(skills.some((s) => s.id === 'lab.good')).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.source === 'plugin' && e.label.startsWith('lab: '))).toBe(true);
  });

  it('without a scan — the default, as in tests and the eval harness — no plugin skills', async () => {
    writePlugin(pluginsDir, 'lab', { skills: ['skills/a.md'] }, { 'skills/a.md': skillFile('lab.a', 'A') });
    expect((await loadSkillCatalog(userDir)).skills.some((s) => s.source === 'plugin')).toBe(false);
  });
});
