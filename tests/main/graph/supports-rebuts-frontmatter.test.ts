/**
 * Indexer integration for the conversational #409 / #410 rework.
 *
 * The Find Supporting / Opposing Arguments tools file a single note
 * whose frontmatter `supports: <claim-uri>` (or `rebuts:`) is meant
 * to materialise a thought:supports / thought:rebuts triple from the
 * analysis-note's IRI to the claim node. That requires two pieces of
 * indexer support (both new in this PR):
 *
 *   1. `supports` and `rebuts` are mapped to thought-namespace
 *      predicates in `frontmatter-predicates.ts`.
 *   2. `frontmatterValueToTerm` recognises bare `https://…` strings
 *      as IRI nodes (vs. plain string literals).
 *
 * If either drifts, the analysis note's structural fact silently
 * disappears from the graph — these tests pin the round-trip.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('frontmatter `supports: <uri>` → thought:supports triple (#409)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-supports-rebuts-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('materialises a thought:supports edge from analysis note → claim URI', async () => {
    const analysisRel = 'notes/supporting-args-for-z.md';
    const analysisBody = [
      '---',
      'title: Supporting arguments — Z is true',
      'supports: https://minerva.dev/c/claim-z',
      '---',
      '',
      '# Supporting arguments — Z is true',
      '',
      '## Argument 1',
      'Body.',
      '',
    ].join('\n');
    await indexNote(ctx, analysisRel, analysisBody);

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?subject ?target WHERE {
        ?subject thought:supports ?target .
      }
    `);
    const rows = r.results as Array<{ subject: string; target: string }>;
    expect(rows.length).toBe(1);
    // Subject is the analysis note's IRI; target is the bare claim URI
    // (NOT a literal string of the URI).
    expect(rows[0].subject).toMatch(/supporting-args-for-z/);
    expect(rows[0].target).toBe('https://minerva.dev/c/claim-z');
  });

  it('materialises a thought:rebuts edge for the opposing-arguments analogue (#410)', async () => {
    await indexNote(ctx, 'notes/opposing-args.md', [
      '---',
      'rebuts: https://minerva.dev/c/claim-w',
      '---',
      '',
      '# Opposing.',
    ].join('\n'));

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?subject ?target WHERE {
        ?subject thought:rebuts ?target .
      }
    `);
    const rows = r.results as Array<{ subject: string; target: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].target).toBe('https://minerva.dev/c/claim-w');
  });

  it('keeps non-URI string values as plain literals (no spurious IRI promotion)', async () => {
    // Sanity-check the URI detection: a frontmatter value that's NOT a
    // URI (e.g. a regular note title) must still land as a string
    // literal, not as an IRI. Otherwise every short URL-like string
    // would silently become a graph edge.
    await indexNote(ctx, 'notes/x.md', '---\nauthor: Alice Smith\n---\n');
    const r = await queryGraph(ctx, `
      PREFIX dc: <http://purl.org/dc/terms/>
      SELECT ?o WHERE { ?s dc:creator ?o }
    `);
    const rows = r.results as Array<{ o: string }>;
    expect(rows.length).toBe(1);
    // dc:creator with a literal "Alice Smith", not an IRI.
    expect(rows[0].o).toBe('Alice Smith');
  });

  it('does NOT promote URL-like substrings inside longer text', async () => {
    // A paragraph mentioning a URL in passing should stay as a literal,
    // not get IRI-promoted. The regex anchors at start and end so any
    // surrounding whitespace or trailing prose disqualifies the match.
    await indexNote(ctx, 'notes/y.md', [
      '---',
      'description: See https://example.com/docs for the original.',
      '---',
      '',
    ].join('\n'));
    const r = await queryGraph(ctx, `
      PREFIX dc: <http://purl.org/dc/terms/>
      SELECT ?o WHERE { ?s dc:description ?o }
    `);
    const rows = r.results as Array<{ o: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].o).toMatch(/^See https:\/\//);
  });
});
