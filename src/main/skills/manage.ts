/**
 * User-skill management (#629): import a `.md` file or a Claude-style skill
 * folder into ~/.minerva/skills/, remove a user skill, and reveal the folder.
 * Validation reuses the parser so a bad file is rejected with a clear message
 * before anything is copied. Modeled on the CSL-import flow.
 */

import { dialog, shell, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { userSkillsDir, loadSkillCatalog } from './loader';
import { parseSkill } from './parse';

export interface ImportedSkill {
  id: string;
  name: string;
}

/** Validate + copy a skill from an arbitrary path into the user skills dir.
 *  `dir` is injectable for tests; defaults to ~/.minerva/skills/. */
export async function importSkillFromPath(src: string, dir: string = userSkillsDir()): Promise<ImportedSkill> {
  const stat = await fs.stat(src);
  const isFolder = stat.isDirectory();

  let content: string;
  let destName: string;
  if (isFolder) {
    destName = path.basename(src);
    const skillMd = path.join(src, 'SKILL.md');
    try {
      content = await fs.readFile(skillMd, 'utf-8');
    } catch {
      throw new Error('That folder has no SKILL.md — pick a skill folder or a single .md file.');
    }
  } else {
    if (!src.toLowerCase().endsWith('.md')) {
      throw new Error('Pick a .md file or a folder containing SKILL.md.');
    }
    destName = path.basename(src);
    content = await fs.readFile(src, 'utf-8');
  }

  // Validate before copying.
  const parsed = parseSkill(content, 'user', isFolder ? path.join(src, 'SKILL.md') : src);
  if (!parsed.skill) {
    throw new Error(`This file isn't a valid skill:\n• ${parsed.errors.join('\n• ')}`);
  }

  // Additive only — can't shadow stock or duplicate an existing skill.
  const catalog = await loadSkillCatalog(dir);
  const clash = catalog.skills.find((s) => s.id === parsed.skill!.id);
  if (clash) {
    throw new Error(
      clash.source === 'stock'
        ? `A built-in skill already uses the id "${parsed.skill.id}". User skills can't override stock — disable it and give yours a different id.`
        : `You already have a skill with the id "${parsed.skill.id}".`,
    );
  }

  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, destName);
  try {
    await fs.access(dest);
    throw new Error(`A skill named "${destName}" already exists in your skills folder.`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; // re-throw the "already exists" Error
  }

  if (isFolder) {
    await fs.cp(src, dest, { recursive: true });
  } else {
    await fs.copyFile(src, dest);
  }
  return { id: parsed.skill.id, name: parsed.skill.name };
}

/** Show the open dialog and import the chosen skill. Returns null on cancel. */
export async function pickAndImportSkill(win: BrowserWindow): Promise<ImportedSkill | null> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Import skill',
    buttonLabel: 'Import',
    // macOS lets a single dialog accept either a file or a folder.
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'Skill', extensions: ['md'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return importSkillFromPath(result.filePaths[0]!); // non-empty checked above
}

/** Delete a user skill by id (the bare .md file, or the folder for SKILL.md).
 *  `dir` is injectable for tests; defaults to ~/.minerva/skills/. */
export async function removeUserSkill(id: string, dir: string = userSkillsDir()): Promise<void> {
  const catalog = await loadSkillCatalog(dir);
  const skill = catalog.skills.find((s) => s.id === id && s.source === 'user');
  if (!skill) throw new Error(`No user skill with id "${id}".`);
  if (/[/\\]SKILL\.md$/i.test(skill.filePath)) {
    await fs.rm(path.dirname(skill.filePath), { recursive: true, force: true });
  } else {
    await fs.rm(skill.filePath, { force: true });
  }
}

/** Reveal ~/.minerva/skills/ in the OS file manager, creating it if needed. */
export async function revealSkillsFolder(): Promise<void> {
  const dir = userSkillsDir();
  await fs.mkdir(dir, { recursive: true });
  await shell.openPath(dir);
}
