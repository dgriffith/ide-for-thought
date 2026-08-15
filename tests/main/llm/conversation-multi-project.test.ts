/**
 * Two thoughtbases open at once keep separate conversations (#1743).
 *
 * The module used to hold the open project in two module-level variables, set
 * by an `initConversations(rootPath)` that ran once per project. Opening a
 * second thoughtbase overwrote them, so from that moment BOTH windows read and
 * wrote the same project's `.minerva/conversations/` — one window's transcripts
 * filed under the other's thoughtbase, its tab list restored as the other's, and
 * its conversation triples projected into the other's graph.
 *
 * These tests interleave two projects deliberately: every case creates in A,
 * then in B, then reads back from A. Under the old code the second `init` won
 * and the A-side reads came back as B's, so a regression here fails rather than
 * quietly reappearing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import {
  create,
  load,
  listActive,
  appendMessage,
  loadUIState,
  saveUIState,
} from '../../../src/main/llm/conversation';

function mkTempProject(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `minerva-conv-${label}-`));
}

/** Conversation JSON files (not the `_ui.json` sibling) under a project. */
function conversationFiles(root: string): string[] {
  const dir = path.join(root, '.minerva', 'conversations');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
}

describe('conversations with two thoughtbases open (#1743)', () => {
  let rootA: string;
  let rootB: string;
  let ctxA: ProjectContext;
  let ctxB: ProjectContext;

  beforeEach(async () => {
    rootA = mkTempProject('projA');
    rootB = mkTempProject('projB');
    ctxA = projectContext(rootA);
    ctxB = projectContext(rootB);
    // Order matters: B is initialised second, which is exactly what used to
    // capture conversation storage for both.
    await initGraph(ctxA);
    await initGraph(ctxB);
  });

  afterEach(async () => {
    await fsp.rm(rootA, { recursive: true, force: true });
    await fsp.rm(rootB, { recursive: true, force: true });
  });

  it('files each conversation under its own project', async () => {
    const convA = await create(rootA, { notePath: 'a.md' });
    const convB = await create(rootB, { notePath: 'b.md' });

    expect(conversationFiles(rootA)).toEqual([`${convA.id}.json`]);
    expect(conversationFiles(rootB)).toEqual([`${convB.id}.json`]);
  });

  it('lists only the calling project\'s conversations', async () => {
    const convA = await create(rootA, { notePath: 'a.md' });
    const convB = await create(rootB, { notePath: 'b.md' });

    expect((await listActive(rootA)).map((c) => c.id)).toEqual([convA.id]);
    expect((await listActive(rootB)).map((c) => c.id)).toEqual([convB.id]);
  });

  it('does not resolve one project\'s conversation id against the other', async () => {
    const convA = await create(rootA, { notePath: 'a.md' });

    expect(await load(rootA, convA.id)).not.toBeNull();
    // Not "found in the wrong place" — not found at all.
    expect(await load(rootB, convA.id)).toBeNull();
  });

  it('appends a turn to the project that owns the conversation', async () => {
    const convA = await create(rootA, { notePath: 'a.md' });
    await create(rootB, { notePath: 'b.md' });

    await appendMessage(rootA, convA.id, 'user', 'build me a thoughtbase');

    const reloaded = await load(rootA, convA.id);
    expect(reloaded?.messages.map((m) => m.content)).toEqual(['build me a thoughtbase']);
    // B's transcript is untouched by A's turn.
    const bConvs = await listActive(rootB);
    expect(bConvs[0]?.messages).toEqual([]);
  });

  it('keeps each project\'s panel state separate', async () => {
    await saveUIState(rootA, { visible: true, height: 500, activeTabId: 'tab-a' });
    await saveUIState(rootB, { visible: false, height: 200, activeTabId: 'tab-b' });

    expect(await loadUIState(rootA)).toEqual({ visible: true, height: 500, activeTabId: 'tab-a' });
    expect(await loadUIState(rootB)).toEqual({ visible: false, height: 200, activeTabId: 'tab-b' });
  });

  it('projects each conversation into its own graph', async () => {
    // The half of the bug that outlives a restart: triples written into the
    // wrong thoughtbase's graph stay there.
    const convA = await create(rootA, { notePath: 'a.md' });

    const inA = await queryGraph(ctxA, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?c WHERE { ?c a thought:Conversation }
    `);
    const inB = await queryGraph(ctxB, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?c WHERE { ?c a thought:Conversation }
    `);

    expect(inA.results.map((r) => String(r.c))).toContain(
      `https://minerva.dev/ontology/thought#conversation/${convA.id}`,
    );
    expect(inB.results).toEqual([]);
  });

  it('answers with an empty list for a project that has no conversations yet', async () => {
    // The panel asks on mount. "Nothing yet" is a real answer, not a failure.
    expect(await listActive(rootA)).toEqual([]);
    expect(await loadUIState(rootA)).toEqual({ visible: false, height: 320, activeTabId: null });
  });
});
