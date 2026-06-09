/**
 * Skill loader (#624). Assembles the skill catalog from two sources:
 *
 *   - **stock**: read-only `*.md` files bundled in `./stock/`, embedded at
 *     build time via Vite's `import.meta.glob` (no filesystem packaging).
 *   - **user**: `~/.minerva/skills/` — either bare `*.md` files or folders
 *     containing `SKILL.md` (Claude-style), read at runtime via fs.
 *
 * User skills are additive only: a user skill whose id collides with a stock
 * skill is rejected (it can't shadow stock) — to change a stock skill you
 * disable it and author your own (later phases). Parse failures are isolated
 * per file so one bad skill never breaks the catalog.
 *
 * No menu/registry/UI wiring here — that's Phase 3. This module only loads and
 * exposes the catalog (consumed by the `skills:list` IPC handler).
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type SkillCatalog,
  type SkillDef,
  type SkillLoadError,
} from '../../shared/skills/types';
import { parseSkill } from './parse';

// Embedded stock skills. Empty until phases 4–6 migrate the hardcoded tools.
const STOCK_RAW = import.meta.glob('./stock/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function userSkillsDir(): string {
  return path.join(os.homedir(), '.minerva', 'skills');
}

function loadStock(): { skills: SkillDef[]; errors: SkillLoadError[] } {
  const skills: SkillDef[] = [];
  const errors: SkillLoadError[] = [];
  for (const [key, content] of Object.entries(STOCK_RAW)) {
    const r = parseSkill(content, 'stock', key);
    if (r.skill) skills.push(r.skill);
    else for (const message of r.errors) errors.push({ source: 'stock', filePath: key, label: r.label, message });
  }
  return { skills, errors };
}

async function readSkillFiles(dir: string): Promise<{ filePath: string; content: string }[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: { filePath: string; content: string }[] = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      const fp = path.join(dir, ent.name);
      out.push({ filePath: fp, content: await fs.readFile(fp, 'utf-8') });
    } else if (ent.isDirectory()) {
      // Claude-style: a folder containing SKILL.md (+ optional assets).
      const fp = path.join(dir, ent.name, 'SKILL.md');
      try {
        out.push({ filePath: fp, content: await fs.readFile(fp, 'utf-8') });
      } catch { /* folder without a SKILL.md — not a skill */ }
    }
  }
  return out;
}

async function loadUser(dir: string): Promise<{ skills: SkillDef[]; errors: SkillLoadError[] }> {
  const skills: SkillDef[] = [];
  const errors: SkillLoadError[] = [];
  for (const { filePath, content } of await readSkillFiles(dir)) {
    const r = parseSkill(content, 'user', filePath);
    if (r.skill) skills.push(r.skill);
    else for (const message of r.errors) errors.push({ source: 'user', filePath, label: r.label, message });
  }
  return { skills, errors };
}

/**
 * Build the catalog. Stock loads first and wins id collisions; a user skill
 * colliding with stock (or an earlier user skill) is rejected with an error.
 * `dir` is injectable for tests; defaults to `~/.minerva/skills/`.
 */
export async function loadSkillCatalog(dir: string = userSkillsDir()): Promise<SkillCatalog> {
  const stock = loadStock();
  const user = await loadUser(dir);

  const byId = new Map<string, SkillDef>();
  const errors: SkillLoadError[] = [...stock.errors, ...user.errors];

  for (const s of stock.skills) {
    if (byId.has(s.id)) {
      errors.push({ source: 'stock', filePath: s.filePath, label: s.name, message: `duplicate stock skill id "${s.id}"` });
      continue;
    }
    byId.set(s.id, s);
  }
  for (const s of user.skills) {
    const existing = byId.get(s.id);
    if (existing) {
      const clash = existing.source === 'stock'
        ? `id "${s.id}" is already a stock skill; user skills can't override stock`
        : `duplicate user skill id "${s.id}"`;
      errors.push({ source: 'user', filePath: s.filePath, label: s.name, message: clash });
      continue;
    }
    byId.set(s.id, s);
  }

  return { skills: [...byId.values()], errors };
}

// --- Cached singleton for the running app ------------------------------------

let cached: SkillCatalog | null = null;

export async function getSkillCatalog(): Promise<SkillCatalog> {
  if (!cached) cached = await loadSkillCatalog();
  return cached;
}

export async function reloadSkillCatalog(): Promise<SkillCatalog> {
  cached = await loadSkillCatalog();
  return cached;
}
