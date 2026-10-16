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
import type { PluginScan } from '../../shared/plugins/format';
import { contributionsTo, getPluginScan } from '../plugins/registry';

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
    // A listing of a skills folder (bundled stock/, or the user's
    // ~/.minerva/skills/), not the thoughtbase root — the project-tree
    // ignore policy (`shared/ignored-dirs.ts`) doesn't apply here. A
    // stray node_modules would just fail the SKILL.md read below and get
    // skipped like any other non-skill folder.
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
 * Plugin skills (#2633): each contributed `.md`, or a skill folder's
 * `SKILL.md`, parsed as `source: 'plugin'` and stamped with its plugin.
 */
async function loadPlugins(scan: PluginScan): Promise<{ skills: SkillDef[]; errors: SkillLoadError[] }> {
  const skills: SkillDef[] = [];
  const errors: SkillLoadError[] = [];
  for (const { plugin, contribution } of contributionsTo(scan, 'skills')) {
    const filePath = contribution.kind === 'folder'
      ? path.join(contribution.absolutePath, 'SKILL.md')
      : contribution.absolutePath;
    const origin = { id: plugin.manifest.id, name: plugin.manifest.name, version: plugin.manifest.version };
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (e) {
      // Checked when the plugin was read; gone or unreadable since. This skill
      // only — never the catalog.
      errors.push({ source: 'plugin', filePath, label: `${origin.id}: ${contribution.path}`, message: `couldn't be read (${(e as NodeJS.ErrnoException).code ?? 'error'})` });
      continue;
    }
    const fields = plugin.manifest.settings ?? [];
    const r = parseSkill(content, 'plugin', filePath, {
      readable: new Set(fields.filter((f) => f.kind !== 'secret').map((f) => f.key)),
      secret: new Set(fields.filter((f) => f.kind === 'secret').map((f) => f.key)),
    }, new Set((plugin.manifest.mcpServers ?? []).map((s) => s.key)));
    if (r.skill) skills.push({ ...r.skill, plugin: origin });
    else for (const message of r.errors) errors.push({ source: 'plugin', filePath, label: `${origin.id}: ${r.label}`, message });
  }
  return { skills, errors };
}

/**
 * Build the catalog. Stock loads first and wins id collisions; a user skill
 * colliding with stock (or an earlier user skill) is rejected with an error.
 * Plugin skills load last and can't shadow either (#2633): one whose id — or
 * slash command — is taken is refused, against its plugin. `dir` is
 * injectable for tests; defaults to `~/.minerva/skills/`. `plugins` is the
 * running app's scan; the default is none, so tests and the eval harness see
 * only stock and user skills.
 */
export async function loadSkillCatalog(
  dir: string = userSkillsDir(),
  plugins: PluginScan = { plugins: [], errors: [] },
): Promise<SkillCatalog> {
  const stock = loadStock();
  const user = await loadUser(dir);
  const fromPlugins = await loadPlugins(plugins);

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
  errors.push(...fromPlugins.errors);
  const slashOwner = new Map<string, SkillDef>();
  for (const s of byId.values()) if (s.slashCommand) slashOwner.set(s.slashCommand, s);
  for (const s of fromPlugins.skills) {
    const label = `${s.plugin!.id}: ${s.name}`;
    const existing = byId.get(s.id);
    if (existing) {
      const holder = existing.source === 'plugin' ? `the ${existing.plugin!.id} plugin's skill` : `a ${existing.source} skill`;
      errors.push({ source: 'plugin', filePath: s.filePath, label, message: `id "${s.id}" is already ${holder}; a plugin can't replace it` });
      continue;
    }
    const slashTaken = s.slashCommand ? slashOwner.get(s.slashCommand) : undefined;
    if (slashTaken) {
      errors.push({ source: 'plugin', filePath: s.filePath, label, message: `slash command ${s.slashCommand} is already "${slashTaken.name}"'s; a plugin can't take it` });
      continue;
    }
    byId.set(s.id, s);
    if (s.slashCommand) slashOwner.set(s.slashCommand, s);
  }

  return { skills: [...byId.values()], errors };
}

// --- Cached singleton for the running app ------------------------------------

// The PROMISE is cached, not the resolved catalog. Caching the value leaves a
// window in which two callers both see `null` and both run the whole load —
// 56 stock skills re-parsed — and that window is now routinely open: since
// #2223 the renderer boots alongside startup registration, so its
// `skills:list` lands mid-load rather than after it. A rejected load is
// evicted so the next caller retries, matching the pre-#2223 behaviour of a
// `cached` that was only assigned on success.
let cached: Promise<SkillCatalog> | null = null;

/** The app's catalog: stock, the user's, and installed plugins' (#2633). */
function loadAppCatalog(): Promise<SkillCatalog> {
  return getPluginScan().then((scan) => loadSkillCatalog(userSkillsDir(), scan));
}

export function getSkillCatalog(): Promise<SkillCatalog> {
  cached ??= trackLoad(loadAppCatalog());
  return cached;
}

export function reloadSkillCatalog(): Promise<SkillCatalog> {
  cached = trackLoad(loadAppCatalog());
  return cached;
}

function trackLoad(load: Promise<SkillCatalog>): Promise<SkillCatalog> {
  const tracked: Promise<SkillCatalog> = load.catch((err: unknown) => {
    if (cached === tracked) cached = null;
    throw err;
  });
  return tracked;
}
