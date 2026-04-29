/**
 * Indexer integration for the conversational #408 rework.
 *
 * The Decompose-into-Claims tool files a bundle of N+1 notes — one
 * parent decomposition note plus one note per claim. The structural
 * facts (each note IS a thought:Claim, with a kind, source-text, and
 * link back to the source) come from indexing those notes, not from
 * a parallel triples payload. This test pins the round-trip:
 *
 *   - Parent note's `decomposes:` frontmatter → thought:decomposes
 *   - Child note's `claim-kind:` / `source-text:` / `extracted-from:` /
 *     `extracted-by:` frontmatter → corresponding thought:* triples
 *   - Child note's embedded ```turtle block declaring
 *     `this: a thought:Claim` → the rdf:type triple, so a query
 *     like `?c a thought:Claim` finds it.
 *
 * If any link in that chain drifts (frontmatter mapping renamed, key
 * removed from the system prompt, turtle-block parsing breaks), the
 * structure silently disappears from the graph — these tests catch
 * that.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('decompose-into-claims indexing round-trip (#408 rework)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-decompose-rework-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('child claim note materialises rdf:type, claim-kind, source-text, extracted-from, extracted-by', async () => {
    // Source note has to exist so the wiki-link in extracted-from
    // resolves — index it first.
    await indexNote(ctx, 'notes/standup.md', '# Standup\n');

    const claimRel = 'notes/claims/standup-1-meeting-started-3pm.md';
    const claimBody = [
      '---',
      'title: The meeting started at 3pm.',
      'claim-kind: factual',
      'source-text: We started the meeting at 3pm sharp.',
      'extracted-from: "[[standup]]"',
      'extracted-by: llm:decompose-claims',
      '---',
      '',
      '# The meeting started at 3pm.',
      '',
      '> We started the meeting at 3pm sharp.',
      '',
      '— from [[standup]]',
      '',
      '```turtle',
      'this: a thought:Claim .',
      '```',
      '',
    ].join('\n');
    await indexNote(ctx, claimRel, claimBody);

    // rdf:type Claim — comes from the embedded turtle block.
    const isClaim = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?c WHERE { ?c a thought:Claim . }
    `);
    const claims = isClaim.results as Array<{ c: string }>;
    expect(claims.length).toBe(1);
    expect(claims[0].c).toMatch(/standup-1-meeting-started-3pm/);

    // Frontmatter mappings — claim-kind, source-text, extracted-by.
    const props = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?kind ?sourceText ?extractedBy WHERE {
        ?c a thought:Claim ;
           thought:claimKind ?kind ;
           thought:sourceText ?sourceText ;
           thought:extractedBy ?extractedBy .
      }
    `);
    const propRows = props.results as Array<{ kind: string; sourceText: string; extractedBy: string }>;
    expect(propRows.length).toBe(1);
    expect(propRows[0].kind).toBe('factual');
    expect(propRows[0].sourceText).toBe('We started the meeting at 3pm sharp.');
    expect(propRows[0].extractedBy).toBe('llm:decompose-claims');

    // extracted-from is a wiki-link to the source note — must resolve
    // as an IRI to the source's note URI, not as a string literal.
    const xfrom = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?source WHERE {
        ?c a thought:Claim ;
           thought:extractedFrom ?source .
      }
    `);
    const xfromRows = xfrom.results as Array<{ source: string }>;
    expect(xfromRows.length).toBe(1);
    expect(xfromRows[0].source).toMatch(/standup/);
    expect(xfromRows[0].source).not.toMatch(/standup-1-meeting/); // the analysis note, not the source
  });

  it('parent decomposition note materialises thought:decomposes pointing at the source note', async () => {
    await indexNote(ctx, 'notes/standup.md', '# Standup\n');
    await indexNote(ctx, 'notes/decomposition-of-standup.md', [
      '---',
      'title: Decomposition of standup',
      'decomposes: "[[standup]]"',
      '---',
      '',
      '# Decomposition of standup',
      '',
      'A breakdown of [[standup]].',
      '',
    ].join('\n'));

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?subject ?source WHERE {
        ?subject thought:decomposes ?source .
      }
    `);
    const rows = r.results as Array<{ subject: string; source: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].subject).toMatch(/decomposition-of-standup/);
    expect(rows[0].source).toMatch(/standup/);
    expect(rows[0].source).not.toMatch(/decomposition/);
  });

  it('claimKind also accepts the camelCase frontmatter alias', async () => {
    // Both kebab-case (`claim-kind`) and camelCase (`claimKind`)
    // resolve to the same predicate. The system prompt prefers the
    // kebab-case form, but the model may emit camelCase if the user
    // pushes it that way; we shouldn't lose the triple either way.
    await indexNote(ctx, 'notes/claims/y.md', [
      '---',
      'title: Y is the case.',
      'claimKind: evaluative',
      '---',
      '',
      '# Y',
      '',
      '```turtle',
      'this: a thought:Claim .',
      '```',
      '',
    ].join('\n'));

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?kind WHERE { ?c thought:claimKind ?kind . }
    `);
    const rows = r.results as Array<{ kind: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('evaluative');
  });
});
