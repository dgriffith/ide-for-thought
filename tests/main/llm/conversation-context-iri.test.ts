/**
 * #350: thought:contextNote on a Conversation must be a real note IRI,
 * not the raw `notes/foo.md` relative path. The integration test plants
 * a note + a conversation, then runs the SPARQL join the bug ticket
 * called out — "find the conversation triggered from this note via
 * minerva:relativePath" — and confirms it returns one row.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexNote,
  queryGraph,
  parseIntoStore,
  noteUriFor,
} from '../../../src/main/graph/index';
import {
  initConversations,
  reindexAllConversations,
  create as createConversation,
} from '../../../src/main/llm/conversation';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-conv-iri-test-'));
}

describe('Conversation thought:contextNote is a real IRI (#350)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
    initConversations(root);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('contextNote resolves to a node that joins against minerva:relativePath', async () => {
    // Plant a note so the join target exists in the graph.
    await indexNote(ctx, 'notes/foo.md', '# Foo\nContent.\n');

    // Create a conversation whose contextBundle references that note.
    await createConversation({ notePath: 'notes/foo.md' });

    // The bug ticket's exact query: "what conversation was triggered
    // from this note?". The join only succeeds if contextNote is the
    // note's IRI, not its relative-path string.
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?conv WHERE {
        ?n minerva:relativePath "notes/foo.md" .
        ?conv thought:contextNote ?n .
      }
    `);
    expect((r.results as unknown[]).length).toBe(1);
  });

  it('omits contextNote entirely when there is no notePath', async () => {
    const conv = await createConversation({});
    const expectedIri = `https://minerva.dev/ontology/thought#conversation/${conv.id}`;

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?n WHERE { <${expectedIri}> thought:contextNote ?n . }
    `);
    expect((r.results as unknown[]).length).toBe(0);
  });

  it('reindexAllConversations heals historical relative-path-as-IRI dust', async () => {
    // Simulate a graph.ttl from the pre-fix era: a Conversation with a
    // contextNote pointing at a relative path resolved against an
    // arbitrary base. parseIntoStore + a hand-rolled turtle stands in
    // for "the broken triples already on disk".
    const convId = 'legacy-conv-1';
    const convIri = `https://minerva.dev/ontology/thought#conversation/${convId}`;
    parseIntoStore(ctx, `
      @prefix thought: <https://minerva.dev/ontology/thought#> .
      <${convIri}> a thought:Conversation ;
        thought:conversationStatus thought:active ;
        thought:startedAt "2024-09-01T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
        thought:contextNote <notes/foo.md> .
    `);

    // The matching JSON file the user kept on disk — canonical source.
    await indexNote(ctx, 'notes/foo.md', '# Foo\n');
    const noteIri = noteUriFor(ctx, 'notes/foo.md')!;
    const convDir = path.join(root, '.minerva', 'conversations');
    await fsp.mkdir(convDir, { recursive: true });
    await fsp.writeFile(path.join(convDir, `${convId}.json`), JSON.stringify({
      id: convId,
      contextBundle: { notePath: 'notes/foo.md' },
      messages: [],
      status: 'active',
      startedAt: '2024-09-01T10:00:00Z',
    }), 'utf-8');

    // Re-project. This is what acquireProject does on each open.
    await reindexAllConversations();

    // The corrected IRI is now present.
    const good = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?n WHERE { <${convIri}> thought:contextNote ?n . }
    `);
    const ns = (good.results as Array<{ n: string }>).map((r) => r.n);
    expect(ns).toContain(noteIri);
    // And the historical relative-path dust is gone — clearConversationTriples
    // dropped every contextNote on this subject before re-adding.
    expect(ns.every((u) => u === noteIri)).toBe(true);
  });
});
