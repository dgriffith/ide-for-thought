import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  create,
  appendMessage,
  setModel,
  load,
} from '../../../src/main/llm/conversation';
import { useGraphProject } from '../../helpers/temp-project';

describe('conversation.setModel (issue #168)', () => {
  const project = useGraphProject('minerva-conv-model-test-');
  let root: string;

  beforeEach(() => {
    root = project.root;
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
  const project = useGraphProject('minerva-conv-model-test-');
  let root: string;

  beforeEach(() => {
    root = project.root;
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

describe('conversation transcripts are written atomically (#2369)', () => {
  const project = useGraphProject('minerva-conv-atomic-test-');
  afterEach(() => { vi.restoreAllMocks(); });

  it('an interrupted save leaves the previous transcript whole', async () => {
    const root = project.root;
    const conv = await create(root, { notePath: 'x.md' });
    await setModel(root, conv.id, 'claude-opus-4-7');
    const file = path.join(root, '.minerva', 'conversations', `${conv.id}.json`);
    const before = fs.readFileSync(file, 'utf-8');

    // A crash between "temp file written" and "renamed into place": a raw
    // writeFile would already have overwritten the transcript by now.
    const realRename = fs.promises.rename;
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (to === file) throw new Error('simulated crash');
      await realRename(from, to);
    });
    await expect(setModel(root, conv.id, 'claude-haiku-4-5')).rejects.toThrow('simulated crash');

    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    expect((await load(root, conv.id))?.model).toBe('claude-opus-4-7');
  });
});

// #2416: every transcript mutation is load → change → persist, serialized per
// conversation, so overlapping calls on one transcript all land.
describe('conversation mutations: overlap and corrupt transcript (#2416)', () => {
  const project = useGraphProject('minerva-conv-lock-test-');

  it('an overlapping setModel and appendMessage both land', async () => {
    const conv = await create(project.root, { notePath: 'x.md' });
    await Promise.all([
      appendMessage(project.root, conv.id, 'user', 'hello'),
      setModel(project.root, conv.id, 'claude-opus-4-7'),
      appendMessage(project.root, conv.id, 'assistant', 'hi'),
    ]);
    const reloaded = await load(project.root, conv.id);
    expect(reloaded?.model).toBe('claude-opus-4-7');
    expect(reloaded?.messages.map((m) => m.content)).toEqual(['hello', 'hi']);
  });

  it('a mutation on a corrupt transcript throws and leaves it byte-identical', async () => {
    const conv = await create(project.root, { notePath: 'x.md' });
    const file = path.join(project.root, '.minerva', 'conversations', `${conv.id}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const CORRUPT = '{"id": "x", "messages": [ TRUNCATED';
    fs.writeFileSync(file, CORRUPT, 'utf-8');
    await expect(appendMessage(project.root, conv.id, 'user', 'hello')).rejects.toThrow(/not found/);
    await expect(setModel(project.root, conv.id, 'claude-opus-4-7')).rejects.toThrow(/not found/);
    expect(fs.readFileSync(file, 'utf-8')).toBe(CORRUPT);
  });
});
