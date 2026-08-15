import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import {
  create,
  setModel,
  load,
} from '../../../src/main/llm/conversation';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-conv-model-test-'));
}

describe('conversation.setModel (issue #168)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('new conversations have no model override (undefined = track global default)', async () => {
    const conv = await create(root, { notePath: 'x.md' });
    expect(conv.model).toBeUndefined();
    const reloaded = await load(root, conv.id);
    expect(reloaded?.model).toBeUndefined();
  });

  it('pins a model and persists it', async () => {
    const conv = await create(root, { notePath: 'x.md' });
    await setModel(root, conv.id, 'claude-opus-4-7');
    const reloaded = await load(root, conv.id);
    expect(reloaded?.model).toBe('claude-opus-4-7');
  });

  it('clears the override when passed undefined', async () => {
    const conv = await create(root, { notePath: 'x.md' });
    await setModel(root, conv.id, 'claude-opus-4-7');
    await setModel(root, conv.id, undefined);
    const reloaded = await load(root, conv.id);
    expect(reloaded?.model).toBeUndefined();
  });

  it('each conversation carries its own model independently', async () => {
    const a = await create(root, { notePath: 'a.md' });
    const b = await create(root, { notePath: 'b.md' });
    await setModel(root, a.id, 'claude-opus-4-7');
    await setModel(root, b.id, 'claude-haiku-4-5');

    const reloadedA = await load(root, a.id);
    const reloadedB = await load(root, b.id);
    expect(reloadedA?.model).toBe('claude-opus-4-7');
    expect(reloadedB?.model).toBe('claude-haiku-4-5');
  });

  it('throws on an unknown conversation id', async () => {
    await expect(setModel(root, 'nope', 'claude-opus-4-7')).rejects.toThrow(/not found/i);
  });
});

describe('conversation.create webEnabled (#1533 — per-conversation web)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('defaults to undefined (inherit the global web setting)', async () => {
    const conv = await create(root, { notePath: 'x.md' });
    expect(conv.webEnabled).toBeUndefined();
    expect((await load(root, conv.id))?.webEnabled).toBeUndefined();
  });

  it('persists an explicit web:false from a launching skill', async () => {
    const conv = await create(root, { notePath: 'x.md' }, undefined, { webEnabled: false });
    expect(conv.webEnabled).toBe(false);
    expect((await load(root, conv.id))?.webEnabled).toBe(false);
  });

  it('persists an explicit web:true', async () => {
    const conv = await create(root, { notePath: 'x.md' }, undefined, { webEnabled: true });
    expect((await load(root, conv.id))?.webEnabled).toBe(true);
  });
});
