/**
 * Glossary Term stock object type: lets a note assert `type: glossary-term`
 * in frontmatter instead of hand-writing an embedded
 * ```turtle this: a thought:Term . ``` block — same pattern as the Claim
 * stock type (#2176), applied to the glossary (#1142) the
 * `generate-glossary`/`add-term-to-glossary` skills already author via a
 * plain `term`/`disambiguation`/`see-also` frontmatter schema.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, queryGraph, getNoteTypedProperties } from '../../../src/main/graph/index';
import { loadTypeCatalog } from '../../../src/main/types/loader';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-glossary-term-type-');
let root: string;
let ctx: ProjectContext;

function writeNote(rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}

beforeEach(() => {
  root = project.root;
  ctx = project.ctx;
});

describe('stock Glossary Term type loads', () => {
  it('has a PascalCase class name, thought:Term externalClass, and the declared properties', async () => {
    const cat = await loadTypeCatalog(root);
    const term = cat.types.find((t) => t.id === 'glossary-term')!;
    expect(term.classLocalName).toBe('GlossaryTerm');
    expect(term.source).toBe('stock');
    expect(term.externalClass).toBe('thought:Term');
    expect(term.properties.map((p) => p.name)).toEqual(['term', 'disambiguation', 'see-also']);
    expect(term.properties.find((p) => p.name === 'see-also')).toMatchObject({
      type: 'link-to-type', targetType: 'glossary-term', predicate: 'thought:seeAlso',
    });
    expect(cat.errors.filter((e) => e.source === 'stock')).toEqual([]);
  });

  it('does not disturb the other stock types', async () => {
    const cat = await loadTypeCatalog(root);
    for (const id of ['book', 'person', 'meeting', 'project', 'idea', 'article', 'place', 'event', 'claim']) {
      expect(cat.types.find((t) => t.id === id)?.source).toBe('stock');
    }
  });
});

describe('a `type: glossary-term` note indexes correctly', () => {
  it('is discoverable as thought:Term via the class-level subClassOf, no embedded turtle needed', async () => {
    writeNote(
      'glossary/Semigroup.md',
      '---\ntitle: Semigroup\ntype: glossary-term\nterm: Semigroup\n---\n\nA set with an associative binary operation.\n',
    );
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?p WHERE { ?n minerva:relativePath ?p ; a/rdfs:subClassOf* thought:Term . }
    `);
    expect((results as Array<{ p: string }>).map((r) => r.p)).toEqual(['glossary/Semigroup.md']);
  });

  it('see-also materializes under thought:seeAlso to another term, matching the plain-frontmatter convention', async () => {
    writeNote('glossary/Monoid.md', '---\ntitle: Monoid\ntype: glossary-term\nterm: Monoid\n---\n');
    writeNote(
      'glossary/Semigroup.md',
      '---\ntitle: Semigroup\ntype: glossary-term\nterm: Semigroup\nsee-also: "[[Monoid]]"\n---\n',
    );
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?p WHERE {
        ?n thought:seeAlso ?other ; minerva:relativePath ?p .
        ?other minerva:relativePath "glossary/Monoid.md" .
      }
    `);
    expect((results as Array<{ p: string }>).map((r) => r.p)).toEqual(['glossary/Semigroup.md']);
  });

  it('term/disambiguation declared properties read back through the typed-property projection', async () => {
    writeNote(
      'glossary/Semigroup.md',
      '---\ntitle: Semigroup\ntype: glossary-term\nterm: Semigroup\ndisambiguation: "Not to be confused with a Monoid."\n---\n',
    );
    await indexAllNotes(ctx);

    const props = await getNoteTypedProperties(ctx, 'glossary/Semigroup.md');
    expect(props.type?.id).toBe('glossary-term');
    const byName = Object.fromEntries(props.properties.map((p) => [p.name, p.value]));
    expect(byName.term).toBe('Semigroup');
    expect(byName.disambiguation).toBe('Not to be confused with a Monoid.');
  });

  it('aliases keep resolving via the pre-existing global alias map, unaffected by typing', async () => {
    writeNote(
      'glossary/Semigroup.md',
      '---\ntitle: Semigroup\ntype: glossary-term\nterm: Semigroup\naliases: [semigroups]\n---\n',
    );
    writeNote('Referencer.md', '---\ntitle: Referencer\n---\n\nSee [[semigroups]] for details.\n');
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?p WHERE {
        ?n minerva:relativePath "Referencer.md" ; minerva:references ?target .
        ?target minerva:relativePath ?p .
      }
    `);
    expect((results as Array<{ p: string }>).map((r) => r.p)).toEqual(['glossary/Semigroup.md']);
  });
});

describe('materializes types:GlossaryTerm as an rdfs:Class alongside the rest', () => {
  it('carries a typeId of "glossary-term"', async () => {
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `SELECT ?id WHERE { ?c a rdfs:Class ; minerva:typeId ?id } ORDER BY ?id`);
    expect((results as Array<{ id: string }>).map((r) => r.id)).toContain('glossary-term');
  });
});
