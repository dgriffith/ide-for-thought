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
      relative_path: 'notes/standup.md',
      content: FLESHED,
      note: 'Flesh out the standup note',
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].relativePath).toBe('notes/standup.md');
    expect(calls[0].beforeContent).toBe(STUB);
    expect(calls[0].afterContent).toBe(FLESHED);
    expect(calls[0].note).toBe('Flesh out the standup note');
    // The tool only proposes — the file on disk is untouched.
    expect(await fsp.readFile(path.join(root, 'notes/standup.md'), 'utf-8')).toBe(STUB);
  });

  it('defaults the card summary to "Rewrite <path>" when note is omitted', async () => {
    const { calls, callbacks } = capture();
    await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      relative_path: 'notes/standup.md',
      content: FLESHED,
    }, callbacks);
    expect(calls[0].note).toBe('Rewrite notes/standup.md');
  });

  it('errors (no draft) when the note does not exist', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      relative_path: 'notes/ghost.md',
      content: FLESHED,
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/no such note/i);
    expect(calls).toHaveLength(0);
  });

  it('errors on a non-markdown path', async () => {
    const { callbacks } = capture();
    await seed('data.txt', 'x');
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      relative_path: 'data.txt',
      content: 'y',
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/only \.md/i);
  });

  it('errors on an identical (no-op) rewrite', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      relative_path: 'notes/standup.md',
      content: STUB,
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/identical/i);
    expect(calls).toHaveLength(0);
  });

  it('validates required input', async () => {
    const { callbacks } = capture();
    expect((await executeNotebaseTool(toolCtx(), 'propose_note_body', { content: FLESHED }, callbacks)).isError).toBe(true);
    expect((await executeNotebaseTool(toolCtx(), 'propose_note_body', { relative_path: 'notes/standup.md' }, callbacks)).isError).toBe(true);
  });

  it('reports out-of-conversation use as an error', async () => {
    // No onNoteBodyDraft callback → the tool has no UI surface to draft into.
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_body', {
      relative_path: 'notes/standup.md',
      content: FLESHED,
    }, {});
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/only available in conversation contexts/i);
  });
});
