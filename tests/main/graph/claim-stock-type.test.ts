/**
 * Claim stock object type: lets a note assert `type: claim` in frontmatter
 * instead of hand-writing an embedded ` ```turtle this: a thought:Claim . ``` `
 * block, and gives Claim first-class `supports`/`rebuts` properties that land
 * under the SAME `thought:supports`/`thought:rebuts` predicates the
 * `find-supporting-arguments`/`crystallize` skills and the `:::argument`
 * embed (#907) already key off — see #2036's `externalClass`/`predicate`
 * mechanism, which this reuses (the Person/foaf:Person precedent).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, queryGraph, getNoteTypedProperties } from '../../../src/main/graph/index';
import { loadTypeCatalog } from '../../../src/main/types/loader';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-claim-type-');
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

describe('stock Claim type loads', () => {
  it('has a PascalCase class name, thought:Claim externalClass, and the declared properties', async () => {
    const cat = await loadTypeCatalog(root);
    const claim = cat.types.find((t) => t.id === 'claim')!;
    expect(claim.classLocalName).toBe('Claim');
    expect(claim.source).toBe('stock');
    expect(claim.externalClass).toBe('thought:Claim');
    expect(claim.properties.map((p) => p.name)).toEqual([
      'claimKind', 'verificationStatus', 'currencyStatus', 'asOfDate', 'hasPrimarySource', 'supports', 'rebuts',
    ]);
    expect(claim.properties.find((p) => p.name === 'supports')).toMatchObject({
      type: 'link-to-type', targetType: 'claim', predicate: 'thought:supports',
    });
    expect(claim.properties.find((p) => p.name === 'rebuts')).toMatchObject({
      type: 'link-to-type', targetType: 'claim', predicate: 'thought:rebuts',
    });
    expect(cat.errors.filter((e) => e.source === 'stock')).toEqual([]);
  });

  it('does not disturb the original stock types', async () => {
    const cat = await loadTypeCatalog(root);
    for (const id of ['book', 'person', 'meeting', 'project', 'idea', 'article', 'place', 'event']) {
      expect(cat.types.find((t) => t.id === id)?.source).toBe('stock');
    }
  });
});

describe('a `type: claim` note indexes correctly', () => {
  it('is discoverable as thought:Claim via the class-level subClassOf, no embedded turtle needed', async () => {
    writeNote('Remote work helps.md', '---\ntitle: Remote work helps\ntype: claim\n---\n\nSome assertion.\n');
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?p WHERE { ?n minerva:relativePath ?p ; a/rdfs:subClassOf* thought:Claim . }
    `);
    expect((results as Array<{ p: string }>).map((r) => r.p)).toEqual(['Remote work helps.md']);
  });

  it('supports/rebuts materialize under thought:supports/thought:rebuts, matching the plain-frontmatter convention', async () => {
    writeNote('Claim A.md', '---\ntitle: Claim A\ntype: claim\n---\n');
    writeNote('Claim B.md', '---\ntitle: Claim B\ntype: claim\n---\n');
    writeNote('Grounds.md', '---\ntitle: Grounds\nsupports: "[[Claim A]]"\n---\n');
    writeNote('Rebuttal.md', '---\ntitle: Rebuttal\ntype: claim\nrebuts: "[[Claim A]]"\n---\n');
    await indexAllNotes(ctx);

    const supporters = await queryGraph(ctx, `
      SELECT ?p WHERE {
        ?n thought:supports ?claim ; minerva:relativePath ?p .
        ?claim minerva:relativePath "Claim A.md" .
      } ORDER BY ?p
    `);
    expect((supporters.results as Array<{ p: string }>).map((r) => r.p)).toEqual(['Grounds.md']);

    const rebutters = await queryGraph(ctx, `
      SELECT ?p WHERE {
        ?n thought:rebuts ?claim ; minerva:relativePath ?p .
        ?claim minerva:relativePath "Claim A.md" .
      }
    `);
    expect((rebutters.results as Array<{ p: string }>).map((r) => r.p)).toEqual(['Rebuttal.md']);
  });

  it('enum/date/text declared properties read back through the typed-property projection', async () => {
    writeNote(
      'Claim A.md',
      '---\ntitle: Claim A\ntype: claim\nclaimKind: factual\nverificationStatus: corroborated\nasOfDate: 2026-01-15\nhasPrimarySource: "Smith 2020"\n---\n',
    );
    await indexAllNotes(ctx);

    const props = await getNoteTypedProperties(ctx, 'Claim A.md');
    expect(props.type?.id).toBe('claim');
    const byName = Object.fromEntries(props.properties.map((p) => [p.name, p.value]));
    expect(byName.claimKind).toBe('factual');
    expect(byName.verificationStatus).toBe('corroborated');
    expect(byName.asOfDate).toBe('2026-01-15');
    expect(byName.hasPrimarySource).toBe('Smith 2020');
  });
});

describe('materializes types:Claim as an rdfs:Class alongside the rest', () => {
  it('carries a typeId of "claim"', async () => {
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `SELECT ?id WHERE { ?c a rdfs:Class ; minerva:typeId ?id } ORDER BY ?id`);
    expect((results as Array<{ id: string }>).map((r) => r.id)).toContain('claim');
  });
});
