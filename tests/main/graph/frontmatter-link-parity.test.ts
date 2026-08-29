/**
 * Frontmatter wiki-links reach parity with body wiki-links: type prefixes
 * (`[[supports::x]]`) and anchors (`[[x#heading]]`) are honoured and render the
 * SAME RDF a body link would, instead of being flattened to a bare reference.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { indexNote, queryGraph } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

async function targetsUnder(ctx: ProjectContext, src: string, predicateQName: string): Promise<string[]> {
  const { results } = await queryGraph(ctx, `
    SELECT ?t WHERE { ?note minerva:relativePath "${src}" ; ${predicateQName} ?t . }
  `);
  return (results as Array<{ t: string }>).map((r) => r.t);
}

describe('frontmatter ↔ body wiki-link parity', () => {
  const project = useGraphProject('minerva-fm-parity-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    ctx = project.ctx;
    await indexNote(ctx, 'a.md', '# A\n\n## Intro\n\nbody');
  });

  it('a typed frontmatter link renders the same triple as a body link', async () => {
    await indexNote(ctx, 'body.md', '# Body\n\nSee [[supports::a]].');
    await indexNote(ctx, 'fm.md', '---\nrelated: "[[supports::a]]"\n---\n# FM\n');

    // Both emit minerva:supports → a.md.
    const bodyT = await targetsUnder(ctx, 'body.md', 'minerva:supports');
    const fmT = await targetsUnder(ctx, 'fm.md', 'minerva:supports');
    expect(bodyT.length).toBe(1);
    expect(fmT).toEqual(bodyT); // byte-identical target IRI → equivalent RDF

    // The explicit type wins over the key: nothing lands under the key predicate.
    expect(await targetsUnder(ctx, 'fm.md', 'minerva:meta-related')).toEqual([]);
  });

  it('a frontmatter link anchor resolves + appends exactly like a body link', async () => {
    await indexNote(ctx, 'body.md', '# Body\n\n[[a#intro]]');
    await indexNote(ctx, 'fm.md', '---\nrelated: "[[a#intro]]"\n---\n# FM\n');

    const [bodyT] = await targetsUnder(ctx, 'body.md', 'minerva:references');
    // Untyped → keeps the key predicate, but the anchored target matches the body.
    const [fmT] = await targetsUnder(ctx, 'fm.md', 'minerva:meta-related');
    expect(bodyT).toMatch(/note\/a#intro$/);
    expect(fmT).toBe(bodyT);
  });

  it('a typed frontmatter link overrides the key-derived predicate', async () => {
    await indexNote(ctx, 'fm.md', '---\nabout: "[[rebuts::a]]"\n---\n# FM\n');
    // about → dc:subject normally, but rebuts:: wins.
    expect((await targetsUnder(ctx, 'fm.md', 'minerva:rebuts')).length).toBe(1);
    expect(await targetsUnder(ctx, 'fm.md', 'dc:subject')).toEqual([]);
  });

  it('an untyped frontmatter link still keeps the key predicate (about → dc:subject)', async () => {
    await indexNote(ctx, 'fm.md', '---\nabout: "[[a]]"\n---\n# FM\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?p WHERE { ?note minerva:relativePath "fm.md" ; dc:subject ?t . ?t minerva:relativePath ?p . }
    `);
    expect((results as Array<{ p: string }>).map((r) => r.p)).toEqual(['a.md']);
  });

  it('preserves the bare [[sources/<id>]] source convention (#474)', async () => {
    await indexNote(ctx, 'fm.md', '---\nabout: "[[sources/foo]]"\n---\n# FM\n');
    const [t] = await targetsUnder(ctx, 'fm.md', 'dc:subject');
    expect(t).toMatch(/source\/foo$/);
  });
});
