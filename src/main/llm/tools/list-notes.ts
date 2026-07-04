import { readdir } from 'node:fs/promises';
import nodePath from 'node:path';
import * as graph from '../../graph/index';
import { projectContext } from '../../project-context-types';
import type { NotebaseTool, ToolContext } from './types';

async function runListNotes(ctx: ToolContext): Promise<string> {
  const pctx = projectContext(ctx.rootPath);
  const notes = (await listProjectNotes(ctx.rootPath)).sort();
  if (notes.length === 0) return 'No notes in this thoughtbase.';
  const lines = notes.map((p) => `${p} — ${graph.noteTitle(pctx, p)}`);
  return `${notes.length} notes:\n${lines.join('\n')}`;
}

/** Every indexable `.md` note under the root, skipping hidden + ignored dirs. */
async function listProjectNotes(rootPath: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(nodePath.relative(rootPath, full));
    }
  }
  await walk(rootPath);
  return out;
}

export const listNotes: NotebaseTool = {
  definition: {
    name: 'list_notes',
    description:
      'List the thoughtbase structure: every note\'s relative path, title, and ' +
      'folder. Read-only. Use this to understand the current layout before ' +
      'proposing a reorganization (which folders exist, which notes are loose at ' +
      'the root, naming inconsistencies) — search_notes is for finding by ' +
      'keyword, this is for seeing the shape.',
    input_schema: { type: 'object', properties: {} },
  },
  run: async (ctx) => ({ content: await runListNotes(ctx), isError: false }),
};
