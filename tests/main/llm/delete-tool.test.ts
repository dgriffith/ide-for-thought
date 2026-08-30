import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { executeNotebaseTool, type ToolCallbacks } from '../../../src/main/llm/tools';
import { indexNote, disposeProject } from '../../../src/main/graph/index';
import type { ConversationDeleteDraft } from '../../../src/shared/conversation-refactor-drafts';
import { makeGraphProject, type GraphProject } from '../../helpers/temp-project';

let root: string;
let project: GraphProject;
const ctx = () => project.ctx;
const toolCtx = () => ({ rootPath: root, conversationId: 'conv-1' });

async function seed(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
  await indexNote(ctx(), rel, body);
}

function capture(): { calls: ConversationDeleteDraft[]; callbacks: ToolCallbacks } {
  const calls: ConversationDeleteDraft[] = [];
  return { calls, callbacks: { onDeleteDraft: (d) => calls.push(d) } };
}

beforeEach(async () => {
  project = await makeGraphProject('minerva-delete-tool-');
  root = project.root;
  await seed('keeper.md', '# Keeper\n\nlinks [[stale]]'); // links INTO stale
  await seed('stale.md', '# Stale note\n\nbody');
  await seed('orphan.md', '# Orphan');
});
afterEach(async () => {
  disposeProject(ctx());
  await project.cleanup();
});

describe('propose_note_delete', () => {
  it('emits a draft with the notes and their inbound blast radius, deleting nothing', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_delete', {
      paths: ['stale.md', 'orphan.md'],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].items.map((i) => i.path)).toEqual(['stale.md', 'orphan.md']);
    // stale.md is linked from keeper.md (outside the set) → surfaced as inbound.
    const stale = calls[0].items.find((i) => i.path === 'stale.md')!;
    expect(stale.inbound.some((b) => b.source === 'keeper.md')).toBe(true);
    // orphan.md has no inbound links.
    expect(calls[0].items.find((i) => i.path === 'orphan.md')!.inbound).toEqual([]);
    // Nothing deleted — the tool only proposes.
    expect(fs.existsSync(path.join(root, 'stale.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'orphan.md'))).toBe(true);
  });

  it('does not count inbound links from notes also being deleted', async () => {
    const { calls, callbacks } = capture();
    // keeper links to stale; deleting BOTH means the keeper→stale link is not a
    // dangling-link concern (keeper is going too).
    await executeNotebaseTool(toolCtx(), 'propose_note_delete', {
      paths: ['stale.md', 'keeper.md'],
    }, callbacks);
    const stale = calls[0].items.find((i) => i.path === 'stale.md')!;
    expect(stale.inbound).toEqual([]);
  });

  it('skips missing files and non-notes with a warning', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_delete', {
      paths: ['ghost.md', 'notes.txt', 'orphan.md'],
    }, callbacks);
    expect(out.isError).toBe(false);
    expect(calls[0].items.map((i) => i.path)).toEqual(['orphan.md']);
    expect(calls[0].warnings.some((w) => /ghost\.md/.test(w))).toBe(true);
    expect(calls[0].warnings.some((w) => /notes\.txt/.test(w))).toBe(true);
  });

  it('errors when no path is deletable', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_delete', {
      paths: ['ghost.md'],
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('validates input shape', async () => {
    const { callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_delete', { paths: [] }, callbacks);
    expect(out.isError).toBe(true);
  });
});
