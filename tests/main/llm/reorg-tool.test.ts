import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { executeNotebaseTool, type ToolCallbacks } from '../../../src/main/llm/tools';
import { initGraph, indexNote, disposeProject } from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';
import type { ConversationReorgDraft } from '../../../src/shared/conversation-refactor-drafts';

let root: string;
const ctx = () => projectContext(root);
const toolCtx = () => ({ rootPath: root, conversationId: 'conv-1' });

async function seed(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
  await indexNote(ctx(), rel, body);
}

function capture(): { calls: ConversationReorgDraft[]; callbacks: ToolCallbacks } {
  const calls: ConversationReorgDraft[] = [];
  return { calls, callbacks: { onReorgDraft: (d) => calls.push(d) } };
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-reorg-tool-'));
  await initGraph(ctx());
  await seed('a.md', '# A\n\nlinks [[b]]');
  await seed('b.md', '# B\n\nbody');
  await seed('keep.md', '# Keep');
});
afterEach(async () => {
  disposeProject(ctx());
  await fsp.rm(root, { recursive: true, force: true });
});

describe('propose_reorganization (#914)', () => {
  it('emits a batch draft with all planned items, moving nothing', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_reorganization', {
      operations: [
        { path: 'a.md', newPath: 'notes/a.md' },
        { path: 'b.md', newPath: 'notes/b.md' },
      ],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].items.map((i) => i.toPath)).toEqual(['notes/a.md', 'notes/b.md']);
    // Nothing moved.
    expect(fs.existsSync(path.join(root, 'a.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'notes/a.md'))).toBe(false);
  });

  it('surfaces an un-runnable op as a warning and excludes it', async () => {
    const { calls, callbacks } = capture();
    await executeNotebaseTool(toolCtx(), 'propose_reorganization', {
      operations: [
        { path: 'a.md', newPath: 'notes/a.md' },
        { path: 'b.md', newPath: 'keep.md' }, // collides
      ],
    }, callbacks);
    expect(calls[0].items.map((i) => i.fromPath)).toEqual(['a.md']);
    expect(calls[0].warnings.some((w) => /keep\.md/.test(w))).toBe(true);
  });

  it('errors when no operation can be planned', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_reorganization', {
      operations: [{ path: 'ghost.md', newPath: 'x.md' }],
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('validates input shape', async () => {
    const { callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_reorganization', { operations: [] }, callbacks);
    expect(out.isError).toBe(true);
  });
});
