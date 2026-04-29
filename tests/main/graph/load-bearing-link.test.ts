/**
 * Indexer integration for the `load-bearing-for` typed wiki-link (#413).
 *
 * The research tool's value depends entirely on the analysis note's
 * `[[load-bearing-for::source]]` link materialising as a
 * `thought:loadBearingFor` triple — that's the only thing that makes
 * "show me every load-bearing analysis I've filed" queryable. If the
 * link-types entry or the indexer drift, the structure silently
 * disappears from the graph. This test pins the round-trip.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('load-bearing-for typed wiki-link → thought:loadBearingFor (#413)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-load-bearing-link-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('materialises a thought:loadBearingFor triple from analysis note → source note', async () => {
    // The analysis note (the one the research tool would propose).
    const analysisRel = 'notes/load-bearing-claim-of-standup.md';
    const analysisBody = [
      '---',
      'title: Load-bearing claim — standup',
      'load-bearing-for: "[[load-bearing-for::notes/standup]]"',
      '---',
      '',
      '# Load-bearing claim — standup',
      '',
      'Load-bearing for [[load-bearing-for::notes/standup]].',
      '',
      'The argument rides on Z.',
      '',
    ].join('\n');

    // Index the source note first so the link target resolves.
    const sourceRel = 'notes/standup.md';
    await indexNote(ctx, sourceRel, '# Standup\n');
    await indexNote(ctx, analysisRel, analysisBody);

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?subject ?target WHERE {
        ?subject thought:loadBearingFor ?target .
      }
    `);
    const rows = r.results as Array<{ subject: string; target: string }>;
    expect(rows.length).toBeGreaterThan(0);
    // Subject is the analysis note's IRI; target is the source note's IRI.
    expect(rows[0].subject).toMatch(/load-bearing-claim-of-standup/);
    expect(rows[0].target).toMatch(/standup/);
    expect(rows[0].target).not.toMatch(/load-bearing-claim-of-standup/);
  });

  it('emits one triple even when both frontmatter and inline link encode the same fact (dedup at link extraction)', async () => {
    // Both surfaces are intentional in the prompt (frontmatter for
    // structural queries, inline for navigation), but the indexer
    // dedups on (target, type) so we don't double-count the predicate.
    const analysisRel = 'notes/load-bearing-claim-of-thing.md';
    const analysisBody = [
      '---',
      'load-bearing-for: "[[load-bearing-for::notes/thing]]"',
      '---',
      '',
      'Load-bearing for [[load-bearing-for::notes/thing]].',
      '',
      'And again [[load-bearing-for::notes/thing|the same source]].',
    ].join('\n');
    await indexNote(ctx, 'notes/thing.md', '# Thing\n');
    await indexNote(ctx, analysisRel, analysisBody);

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?target WHERE {
        ?subject thought:loadBearingFor ?target .
      }
    `);
    const rows = r.results as Array<{ target: string }>;
    // One subject → one target — the indexer's seen-set in extractLinks
    // dedups on (type, target, anchor).
    const distinctTargets = new Set(rows.map((row) => row.target));
    expect(distinctTargets.size).toBe(1);
  });
});
