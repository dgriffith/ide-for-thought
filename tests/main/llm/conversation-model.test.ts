import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph } from '../../../src/main/graph/index';
import {
  initConversations,
  create,
  setModel,
  load,
} from '../../../src/main/llm/conversation';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-conv-model-test-'));
}

describe('conversation.setModel (issue #168)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
    initConversations(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('new conversations have no model override (undefined = track global default)', async () => {
    const conv = await create({ notePath: 'x.md' });
    expect(conv.model).toBeUndefined();
    const reloaded = await load(conv.id);
    expect(reloaded?.model).toBeUndefined();
  });

  it('pins a model and persists it', async () => {
    const conv = await create({ notePath: 'x.md' });
    await setModel(conv.id, 'claude-opus-4-7');
    const reloaded = await load(conv.id);
    expect(reloaded?.model).toBe('claude-opus-4-7');
  });

  it('clears the override when passed undefined', async () => {
    const conv = await create({ notePath: 'x.md' });
    await setModel(conv.id, 'claude-opus-4-7');
    await setModel(conv.id, undefined);
    const reloaded = await load(conv.id);
    expect(reloaded?.model).toBeUndefined();
  });

  it('each conversation carries its own model independently', async () => {
    const a = await create({ notePath: 'a.md' });
    const b = await create({ notePath: 'b.md' });
    await setModel(a.id, 'claude-opus-4-7');
    await setModel(b.id, 'claude-haiku-4-5');

    const reloadedA = await load(a.id);
    const reloadedB = await load(b.id);
    expect(reloadedA?.model).toBe('claude-opus-4-7');
    expect(reloadedB?.model).toBe('claude-haiku-4-5');
  });

  it('throws on an unknown conversation id', async () => {
    await expect(setModel('nope', 'claude-opus-4-7')).rejects.toThrow(/not found/i);
  });
});
