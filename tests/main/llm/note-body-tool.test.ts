import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { executeNotebaseTool, type ToolCallbacks } from '../../../src/main/llm/tools';
import { initGraph, indexNote, disposeProject } from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';
import type { ConversationNoteBodyDraft } from '../../../src/shared/conversation-note-body-drafts';

let root: string;
const ctx = () => projectContext(root);
const toolCtx = () => ({ rootPath: root, conversationId: 'conv-1' });

async function seed(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
  await indexNote(ctx(), rel, body);
}

function capture(): { calls: ConversationNoteBodyDraft[]; callbacks: ToolCallbacks } {
  const calls: ConversationNoteBodyDraft[] = [];
  return { calls, callbacks: { onNoteBodyDraft: (d) => calls.push(d) } };
}

const STUB = '---\ntags: [meeting]\n---\n# Standup\n\n- shipped X\n';
const FLESHED = '---\ntags: [meeting]\n---\n# Standup\n\nWe shipped X today, unblocking Y.\n';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-note-body-tool-'));
  await initGraph(ctx());
  await seed('notes/standup.md', STUB);
});
afterEach(async () => {
  disposeProject(ctx());
  await fsp.rm(root, { recursive: true, force: true });
});

describe('propose_note_body', () => {
  it('emits a before/after draft and writes nothing', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      edits: [{ relative_path: 'notes/standup.md', content: FLESHED }],
      note: 'Flesh out the standup note',
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].items).toHaveLength(1);
    expect(calls[0].items[0].relativePath).toBe('notes/standup.md');
    expect(calls[0].items[0].beforeContent).toBe(STUB);
    expect(calls[0].items[0].afterContent).toBe(FLESHED);
    expect(calls[0].note).toBe('Flesh out the standup note');
    // The tool only proposes — the file on disk is untouched.
    expect(await fsp.readFile(path.join(root, 'notes/standup.md'), 'utf-8')).toBe(STUB);
  });

  it('batches many notes into ONE draft', async () => {
    // The point of the change: N rewrites are one review card and, on approve,
    // one bundled proposal — not N of each.
    await seed('notes/retro.md', '# Retro\n');
    await seed('notes/plan.md', '# Plan\n');
    const { calls, callbacks } = capture();

    const out = await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      edits: [
        { relative_path: 'notes/standup.md', content: FLESHED },
        { relative_path: 'notes/retro.md', content: '# Retro\n\nWhat went well…\n' },
        { relative_path: 'notes/plan.md', content: '# Plan\n\nNext week…\n' },
      ],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].items.map((i) => i.relativePath)).toEqual([
      'notes/standup.md', 'notes/retro.md', 'notes/plan.md',
    ]);
    expect(calls[0].note).toBe('Rewrite 3 notes');
    // Still nothing written.
    expect(await fsp.readFile(path.join(root, 'notes/retro.md'), 'utf-8')).toBe('# Retro\n');
  });

  it('defaults the card summary to "Rewrite <path>" for a single note', async () => {
    const { calls, callbacks } = capture();
    await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      edits: [{ relative_path: 'notes/standup.md', content: FLESHED }],
    }, callbacks);
    expect(calls[0].note).toBe('Rewrite notes/standup.md');
  });

  it('keeps the good edits and warns about the bad ones', async () => {
    // One bad path in a batch of twenty must not discard the nineteen good
    // rewrites the model just produced.
    await seed('data.txt', 'x');
    const { calls, callbacks } = capture();

    const out = await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      edits: [
        { relative_path: 'notes/standup.md', content: FLESHED },
        { relative_path: 'notes/ghost.md', content: 'nope' },   // missing
        { relative_path: 'data.txt', content: 'y' },            // not a note
        { relative_path: 'notes/standup.md', content: 'dupe' }, // duplicate
      ],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(calls[0].items.map((i) => i.relativePath)).toEqual(['notes/standup.md']);
    expect(calls[0].items[0].afterContent).toBe(FLESHED); // first edit won, not the dupe
    expect(calls[0].warnings.join(' ')).toMatch(/no such note/i);
    expect(calls[0].warnings.join(' ')).toMatch(/only \.md/i);
    expect(calls[0].warnings.join(' ')).toMatch(/duplicate/i);
  });

  it('errors (no draft) when every edit is unusable', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      edits: [{ relative_path: 'notes/ghost.md', content: FLESHED }],
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/no such note/i);
    // No empty review card.
    expect(calls).toHaveLength(0);
  });

  it('treats an identical rewrite as nothing to do', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      edits: [{ relative_path: 'notes/standup.md', content: STUB }],
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/identical/i);
    expect(calls).toHaveLength(0);
  });

  it('validates required input', async () => {
    const { callbacks } = capture();
    const bad = [
      {},                                                        // no edits
      { edits: [] },                                             // empty
      { edits: [{ content: FLESHED }] },                         // no path
      { edits: [{ relative_path: 'notes/standup.md' }] },        // no content
    ];
    for (const input of bad) {
      expect((await executeNotebaseTool(toolCtx(), 'propose_note_body', input, callbacks)).isError).toBe(true);
    }
  });

  it('reports out-of-conversation use as an error', async () => {
    // No onNoteBodyDraft callback → the tool has no UI surface to draft into.
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      edits: [{ relative_path: 'notes/standup.md', content: FLESHED }],
    }, {});
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/only available in conversation contexts/i);
  });
});
