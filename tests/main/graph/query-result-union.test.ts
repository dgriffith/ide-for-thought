/**
 * `queryGraph` answers with a discriminated union (#2363), against a real
 * store: a user's malformed SPARQL is the `{ ok: false; error }` arm — it
 * resolves, never rejects, and carries no `results` a caller could mistake
 * for an answer — while `queryGraphRows`, for SPARQL the app wrote itself,
 * THROWS on the same failure instead of reading as "no rows".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { indexNote, queryGraph, queryGraphRows } from '../../../src/main/graph/index';
import { GraphQueryError } from '../../../src/shared/graph-query';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('queryGraph result union (#2363)', () => {
  const project = useGraphProject('minerva-query-union-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    ctx = project.ctx;
    await indexNote(ctx, 'a.md', '---\ntitle: Note A\n---\n# Note A\n');
  });

  it('a successful query is the ok arm, with rows and columns', async () => {
    const r = await queryGraph(ctx, 'SELECT ?title WHERE { ?n a minerva:Note ; dc:title ?title }');
    expect(r).toEqual({ ok: true, results: [{ title: 'Note A' }], columns: ['title'] });
  });

  it('malformed SPARQL resolves as { ok: false, error } — it does not reject', async () => {
    const r = await queryGraph(ctx, 'SELEKT ?title WHERE { ?n dc:title ?title }');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(typeof r.error).toBe('string');
    expect(r.error.length).toBeGreaterThan(0);
    expect(r).not.toHaveProperty('results');
    expect(r).not.toHaveProperty('columns');
  });

  it('queryGraphRows returns the same rows without the discriminant', async () => {
    await expect(queryGraphRows(ctx, 'SELECT ?title WHERE { ?n a minerva:Note ; dc:title ?title }'))
      .resolves.toEqual({ results: [{ title: 'Note A' }], columns: ['title'] });
  });

  it('queryGraphRows throws on a failed query rather than answering "no rows"', async () => {
    await expect(queryGraphRows(ctx, 'SELEKT ?title WHERE { ?n dc:title ?title }'))
      .rejects.toBeInstanceOf(GraphQueryError);
  });
});
