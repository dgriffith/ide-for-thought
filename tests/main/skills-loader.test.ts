import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';

let dir: string;

const skillFile = (name: string, menu = 'Learning') => `---
name: ${name}
description: desc for ${name}
menu: ${menu}
outputMode: openConversation
---
Body for ${name}.`;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-skills-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('loadSkillCatalog', () => {
  it('returns empty (no errors) when the user dir is missing', async () => {
    const cat = await loadSkillCatalog(path.join(dir, 'does-not-exist'));
    expect(cat.skills).toEqual([]);
    expect(cat.errors).toEqual([]);
  });

  it('loads bare .md files from the user dir', async () => {
    await fs.writeFile(path.join(dir, 'alpha.md'), skillFile('Alpha'));
    await fs.writeFile(path.join(dir, 'beta.md'), skillFile('Beta', 'Analysis'));
    const cat = await loadSkillCatalog(dir);
    expect(cat.errors).toEqual([]);
    expect(cat.skills.map((s) => s.name).sort()).toEqual(['Alpha', 'Beta']);
    expect(cat.skills.every((s) => s.source === 'user')).toBe(true);
  });

  it('loads a Claude-style folder with SKILL.md', async () => {
    const sub = path.join(dir, 'gamma');
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, 'SKILL.md'), skillFile('Gamma'));
    await fs.writeFile(path.join(sub, 'notes.txt'), 'ignored asset');
    const cat = await loadSkillCatalog(dir);
    expect(cat.skills.map((s) => s.name)).toEqual(['Gamma']);
    expect(cat.skills[0].filePath.endsWith('SKILL.md')).toBe(true);
  });

  it('ignores dotfiles and folders without SKILL.md', async () => {
    await fs.writeFile(path.join(dir, '.hidden.md'), skillFile('Hidden'));
    await fs.mkdir(path.join(dir, 'empty-folder'));
    const cat = await loadSkillCatalog(dir);
    expect(cat.skills).toEqual([]);
    expect(cat.errors).toEqual([]);
  });

  it('isolates a bad skill without dropping the good ones', async () => {
    await fs.writeFile(path.join(dir, 'good.md'), skillFile('Good'));
    await fs.writeFile(path.join(dir, 'bad.md'), '---\nname: Bad\n---\nbody'); // missing menu/outputMode/desc
    const cat = await loadSkillCatalog(dir);
    expect(cat.skills.map((s) => s.name)).toEqual(['Good']);
    expect(cat.errors.length).toBeGreaterThan(0);
    expect(cat.errors[0].source).toBe('user');
    expect(cat.errors[0].label).toBe('Bad');
  });

  it('rejects a duplicate user skill id with an error', async () => {
    await fs.writeFile(path.join(dir, 'one.md'), skillFile('Dup'));
    await fs.writeFile(path.join(dir, 'two.md'), skillFile('Dup'));
    const cat = await loadSkillCatalog(dir);
    expect(cat.skills.length).toBe(1);
    expect(cat.errors.some((e) => /duplicate user skill id/.test(e.message))).toBe(true);
  });
});
