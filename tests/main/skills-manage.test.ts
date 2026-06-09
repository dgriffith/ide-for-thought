import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importSkillFromPath, removeUserSkill } from '../../src/main/skills/manage';
import { loadSkillCatalog } from '../../src/main/skills/loader';

let userDir: string;
let srcDir: string;

const skillFile = (name: string, extra = '') => `---
name: ${name}
description: desc for ${name}
menu: Analysis
outputMode: openConversation
${extra}---
Body for ${name}. {{#if note}}{{note.content}}{{/if}}`;

beforeEach(async () => {
  userDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-uskills-'));
  srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-src-'));
});
afterEach(async () => {
  await fs.rm(userDir, { recursive: true, force: true });
  await fs.rm(srcDir, { recursive: true, force: true });
});

describe('importSkillFromPath', () => {
  it('imports a valid .md file into the user dir', async () => {
    const src = path.join(srcDir, 'my-skill.md');
    await fs.writeFile(src, skillFile('My Skill'));
    const res = await importSkillFromPath(src, userDir);
    expect(res).toEqual({ id: 'my-skill', name: 'My Skill' });
    expect(await fs.readFile(path.join(userDir, 'my-skill.md'), 'utf-8')).toContain('My Skill');

    const cat = await loadSkillCatalog(userDir);
    expect(cat.skills.find((s) => s.id === 'my-skill')?.source).toBe('user');
  });

  it('imports a folder containing SKILL.md', async () => {
    const folder = path.join(srcDir, 'fancy');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'SKILL.md'), skillFile('Fancy'));
    await fs.writeFile(path.join(folder, 'asset.txt'), 'bundled');
    const res = await importSkillFromPath(folder, userDir);
    expect(res.name).toBe('Fancy');
    expect(await fs.readFile(path.join(userDir, 'fancy', 'SKILL.md'), 'utf-8')).toContain('Fancy');
    expect(await fs.readFile(path.join(userDir, 'fancy', 'asset.txt'), 'utf-8')).toBe('bundled');
  });

  it('rejects an invalid skill with a descriptive error', async () => {
    const src = path.join(srcDir, 'bad.md');
    await fs.writeFile(src, '---\nname: Bad\n---\nbody'); // missing menu/outputMode/desc
    await expect(importSkillFromPath(src, userDir)).rejects.toThrow(/isn't a valid skill/);
  });

  it('rejects a non-markdown file', async () => {
    const src = path.join(srcDir, 'notes.txt');
    await fs.writeFile(src, 'hello');
    await expect(importSkillFromPath(src, userDir)).rejects.toThrow(/\.md file or a folder/);
  });

  it('rejects a folder without SKILL.md', async () => {
    const folder = path.join(srcDir, 'empty');
    await fs.mkdir(folder);
    await expect(importSkillFromPath(folder, userDir)).rejects.toThrow(/no SKILL\.md/);
  });

  it('rejects an id that collides with a stock skill', async () => {
    const src = path.join(srcDir, 'dup.md');
    await fs.writeFile(src, skillFile('Summarize Clone', 'id: learning.summarize\n'));
    await expect(importSkillFromPath(src, userDir)).rejects.toThrow(/built-in skill/);
  });

  it('rejects a duplicate of an already-imported user skill', async () => {
    const a = path.join(srcDir, 'a.md');
    await fs.writeFile(a, skillFile('Dup', 'id: my.dup\n'));
    await importSkillFromPath(a, userDir);
    const b = path.join(srcDir, 'b.md');
    await fs.writeFile(b, skillFile('Dup Two', 'id: my.dup\n'));
    await expect(importSkillFromPath(b, userDir)).rejects.toThrow(/already have a skill/);
  });

  it('rejects when a file of the same name already exists', async () => {
    const a = path.join(srcDir, 'same.md');
    await fs.writeFile(a, skillFile('First', 'id: my.first\n'));
    await importSkillFromPath(a, userDir);
    // A different source file with the SAME basename but a different id.
    const a2 = path.join(srcDir, 'sub', 'same.md');
    await fs.mkdir(path.dirname(a2));
    await fs.writeFile(a2, skillFile('Second', 'id: my.second\n'));
    await expect(importSkillFromPath(a2, userDir)).rejects.toThrow(/already exists/);
  });
});

describe('removeUserSkill', () => {
  it('removes a bare .md user skill', async () => {
    const src = path.join(srcDir, 'gone.md');
    await fs.writeFile(src, skillFile('Gone', 'id: my.gone\n'));
    await importSkillFromPath(src, userDir);
    await removeUserSkill('my.gone', userDir);
    await expect(fs.access(path.join(userDir, 'gone.md'))).rejects.toThrow();
    expect((await loadSkillCatalog(userDir)).skills.find((s) => s.id === 'my.gone')).toBeUndefined();
  });

  it('removes a folder-form user skill (deletes the whole folder)', async () => {
    const folder = path.join(srcDir, 'foldy');
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'SKILL.md'), skillFile('Foldy', 'id: my.foldy\n'));
    await importSkillFromPath(folder, userDir);
    await removeUserSkill('my.foldy', userDir);
    await expect(fs.access(path.join(userDir, 'foldy'))).rejects.toThrow();
  });

  it('refuses to remove a stock skill', async () => {
    await expect(removeUserSkill('learning.summarize', userDir)).rejects.toThrow(/No user skill/);
  });

  it('errors on an unknown id', async () => {
    await expect(removeUserSkill('nope.nope', userDir)).rejects.toThrow(/No user skill/);
  });
});
