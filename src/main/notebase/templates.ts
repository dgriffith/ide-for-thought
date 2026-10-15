/**
 * Per-project note templates (#475).
 *
 * Templates are plain `.md` files under `.minerva/templates/`. The
 * filename (sans extension) is the template name. Body is a normal
 * markdown file with `{{var}}` placeholders that `substituteTemplate`
 * (shared/templates.ts) resolves at insertion time.
 *
 * Listing the folder is the registry — no separate index file, no
 * config. That keeps templates editable as plain notes once they're
 * in place.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from './fs';
import type { PluginOrigin } from '../../shared/plugins/format';
import { contributionsTo, getPluginScan } from '../plugins/registry';
import { logger } from '../../shared/logger';

const TEMPLATES_DIR = '.minerva/templates';

/** Filenames the stock-seed step writes when the templates folder
 *  doesn't yet exist. Plain enough to demonstrate variable forms
 *  without prescribing a workflow. */
const STOCK_TEMPLATES: ReadonlyArray<{ filename: string; content: string }> = [
  {
    filename: 'Daily note.md',
    content: `# {{date:MMM DD, YYYY}}

## Highlights
- {{cursor}}

## Notes

## Tomorrow
`,
  },
  {
    filename: 'Meeting.md',
    content: `---
date: {{date}}
attendees:
  - {{prompt:Attendees}}
---

# Meeting with {{prompt:Subject}} — {{date:MMM DD}}

## Agenda
- {{cursor}}

## Notes

## Action items
- [ ]
`,
  },
  {
    filename: 'Decision.md',
    content: `---
date: {{date}}
status: proposed
---

# Decision: {{title}}

## Context
{{cursor}}

## Options considered
1.

## Decision

## Consequences
`,
  },
];

export interface TemplateInfo {
  /** Template name as the user sees it (the filename without \`.md\`). */
  name: string;
  /** Filename on disk including the `.md` extension. Unique in a listing:
   *  it's how `readTemplate` finds the body. */
  filename: string;
  /** Set for an installed plugin's template (#2633). */
  plugin?: PluginOrigin;
}

/**
 * Installed plugins' templates (#2633), by filename. A thoughtbase template
 * of the same name hides a plugin's (the thoughtbase's own file wins, as it
 * does for types); a second plugin's template of a name already taken is
 * skipped, and logged against that plugin. So a filename stays unique across
 * the merged listing, and `readTemplate` needs nothing more than it.
 */
async function pluginTemplates(taken: ReadonlySet<string>): Promise<Map<string, { info: TemplateInfo; absolutePath: string }>> {
  const out = new Map<string, { info: TemplateInfo; absolutePath: string }>();
  for (const { plugin, contribution } of contributionsTo(await getPluginScan(), 'note-templates')) {
    const filename = path.basename(contribution.absolutePath);
    const key = filename.toLowerCase();
    if (taken.has(key)) continue;
    const holder = out.get(key);
    if (holder) {
      logger('plugins').warn(`${plugin.manifest.id}: template "${filename}" is already the ${holder.info.plugin?.id} plugin's; skipped`);
      continue;
    }
    const origin = { id: plugin.manifest.id, name: plugin.manifest.name, version: plugin.manifest.version };
    out.set(key, { info: { name: filename.slice(0, -3), filename, plugin: origin }, absolutePath: contribution.absolutePath });
  }
  return out;
}

function templatesDirAbs(rootPath: string): string {
  return path.join(rootPath, TEMPLATES_DIR);
}

/**
 * Idempotent: seed the stock templates if the folder doesn't yet
 * exist. Called on project open so existing projects get them too
 * without needing a separate migration step.
 */
export async function ensureSeeded(rootPath: string): Promise<void> {
  const dir = templatesDirAbs(rootPath);
  try {
    await fs.stat(dir);
    return; // Already exists — respect whatever the user has done.
  } catch {
    // Falls through to seed.
  }
  await fs.mkdir(dir, { recursive: true });
  for (const t of STOCK_TEMPLATES) {
    const full = path.join(dir, t.filename);
    await fs.writeFile(full, t.content, 'utf-8');
  }
}

/** List the .md files in the templates folder, then installed plugins'
 *  (#2633). A missing folder (a user could have deleted it) lists none of
 *  the thoughtbase's; any other read error throws rather than reading as
 *  "no templates". */
export async function listTemplates(rootPath: string): Promise<TemplateInfo[]> {
  const dir = templatesDirAbs(rootPath);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw e;
    entries = []; // no folder — a plugin's templates may still be listed
  }
  const out: TemplateInfo[] = [];
  for (const entry of entries) {
    // A flat listing of `.minerva/templates/`, not a recursive walk of the
    // thoughtbase root — the project-tree ignore policy
    // (`shared/ignored-dirs.ts`) doesn't apply here.
    if (!entry.toLowerCase().endsWith('.md')) continue;
    if (entry.startsWith('.')) continue;
    out.push({
      name: entry.slice(0, -3),
      filename: entry,
    });
  }
  const taken = new Set(out.map((t) => t.filename.toLowerCase()));
  for (const { info } of (await pluginTemplates(taken)).values()) out.push(info);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Read a template body by filename. Throws when the file doesn't
 *  exist — caller treats that as "user deleted the template
 *  underneath us" and falls back to an empty note. */
export async function readTemplate(rootPath: string, filename: string): Promise<string> {
  if (!filename.toLowerCase().endsWith('.md') || filename.includes('/') || filename.includes('\\')) {
    throw new Error(`Invalid template filename: ${filename}`);
  }
  try {
    return await notebaseFs.readFile(rootPath, `${TEMPLATES_DIR}/${filename}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    // Not the thoughtbase's: an installed plugin's, by the same unique name.
    const fromPlugin = (await pluginTemplates(new Set())).get(filename.toLowerCase());
    if (!fromPlugin) throw e;
    return await fs.readFile(fromPlugin.absolutePath, 'utf-8');
  }
}

/**
 * Write a template under `.minerva/templates/<name>.md`. The name
 * argument is sanitised — slashes, backslashes, leading dots, and
 * the `.md` extension are stripped — so the caller can pass the
 * user's typed value through without preprocessing.
 */
export async function saveTemplate(
  rootPath: string,
  rawName: string,
  content: string,
): Promise<TemplateInfo> {
  const cleaned = rawName
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[\\/]/g, '-')
    .replace(/^\.+/, '');
  if (!cleaned) throw new Error('Template name is empty');
  const filename = `${cleaned}.md`;
  await notebaseFs.writeFile(rootPath, `${TEMPLATES_DIR}/${filename}`, content);
  return { name: cleaned, filename };
}
