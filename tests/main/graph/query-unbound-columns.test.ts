/**
 * A SELECT variable that ends up unbound in every row must still appear as a
 * column (from the projection), rather than vanishing from the results. Earlier
 * the columns were derived from the bindings alone, so an always-unbound
 * variable was dropped entirely.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { indexNote, queryGraph } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('queryGraph projected columns', () => {
  const project = useGraphProject('minerva-query-cols-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    ctx = project.ctx;
    await indexNote(ctx, 'a.md', '---\ntitle: Note A\n---\n# Note A\n');
    await indexNote(ctx, 'b.md', '---\ntitle: Note B\n---\n# Note B\n');
  });

  it('keeps a column that is unbound in every row', async () => {
    // ?missing is projected but never bound — no note has dc:description here.
    const { results, columns } = await queryGraph(ctx, `
      SELECT ?title ?missing WHERE {
        ?note rdf:type minerva:Note .
        ?note dc:title ?title .
        OPTIONAL { ?note dc:description ?missing }
      }
      ORDER BY ?title`);

    expect(columns).toEqual(['title', 'missing']); // projection order preserved
    expect(results.length).toBe(2);
    // The rows have a title but no `missing` key.
    expect((results as Record<string, string>[]).map((r) => r.title)).toEqual(['Note A', 'Note B']);
    expect((results[0] as Record<string, string>).missing).toBeUndefined();
  });

  it('reports projected columns even when there are zero rows', async () => {
    const { results, columns } = await queryGraph(ctx, `
      SELECT ?title ?nope WHERE {
        ?note rdf:type minerva:Note .
        ?note dc:title ?title .
        ?note minerva:nonexistentPredicate ?nope .
      }`);
    expect(results.length).toBe(0);
    expect(columns).toEqual(['title', 'nope']);
  });

  it('preserves all bound columns in projection order', async () => {
    const { columns } = await queryGraph(ctx, `
      SELECT ?path ?title WHERE {
        ?note rdf:type minerva:Note .
        ?note dc:title ?title .
        ?note minerva:relativePath ?path .
      }`);
    expect(columns).toEqual(['path', 'title']);
  });
});
