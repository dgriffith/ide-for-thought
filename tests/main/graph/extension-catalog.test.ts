/**
 * The extension catalog in the graph (#2618): the points and the installed
 * contributions as triples, with PROV-O attribution, in a named graph that
 * never reaches graph.ttl, surviving a full reindex, and costing nothing to
 * re-report unchanged.
 */
import { describe, it, expect } from 'vitest';
import { queryGraph, indexAllNotes, serializeUserGraph, setExtensionContributions } from '../../../src/main/graph/index';
import { EXTENSION_POINTS } from '../../../src/shared/extensions/points';
import { STOCK_QUERIES } from '../../../src/shared/stock-queries';
import type { Contribution } from '../../../src/shared/extensions/contributions';
import type { ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const CONTRIBUTIONS: Contribution[] = [
  { point: 'skills', id: 'antithesize', label: 'Antithesize', source: 'stock' },
  { point: 'skills', id: 'my-skill', label: 'My Skill', source: 'user' },
  { point: 'object-types', id: 'recipe', label: 'Recipe', source: 'thoughtbase', location: '.minerva/types/recipe.md' },
  { point: 'mcp-servers', id: 'srv-1', label: 'Files', source: 'user' },
];

async function rows(ctx: ProjectContext, sparql: string): Promise<Record<string, string>[]> {
  const r = await queryGraph(ctx, sparql);
  if (!r.ok) throw new Error(r.error);
  return r.results as Record<string, string>[];
}

const stock = (name: string) => STOCK_QUERIES.find((q) => q.name === name)!.query;

describe('extension catalog in the graph (#2618)', () => {
  const project = useGraphProject('minerva-extension-catalog-');

  it('has every extension point from the moment the graph is open', async () => {
    const found = await rows(project.ctx, `
      SELECT ?id ?rung WHERE { ?p a minerva:ExtensionPoint ; dc:identifier ?id ; minerva:rung ?rung }`);
    expect(found.map((r) => r.id).sort()).toEqual(EXTENSION_POINTS.map((p) => p.id).sort());
    expect(found.find((r) => r.id === 'skills')?.rung).toBe('skill');
  });

  it('attributes each contribution to its supplier', async () => {
    // A project open indexes before reporting contributions; that's what writes
    // the minerva:Project node a thoughtbase's own contributions point at.
    await indexAllNotes(project.ctx);
    setExtensionContributions(project.ctx, CONTRIBUTIONS);
    const found = await rows(project.ctx, `
      SELECT ?id ?agent ?point ?at WHERE {
        ?c a minerva:Contribution ; dc:identifier ?id ; prov:wasAttributedTo ?agent ;
           prov:generatedAtTime ?at ; minerva:contributesTo/dc:identifier ?point .
      }`);
    const by = Object.fromEntries(found.map((r) => [r.id, r]));
    expect(by.antithesize?.agent).toBe('https://minerva.dev/ontology#stock');
    expect(by['my-skill']?.agent).toBe('https://minerva.dev/ontology#localUser');
    expect(by['srv-1']?.point).toBe('mcp-servers');
    // A thoughtbase's own contribution is attributed to its project.
    const project_ = await rows(project.ctx, 'SELECT ?p WHERE { ?p a minerva:Project }');
    expect(by.recipe?.agent).toBe(project_[0]?.p);
    expect(by.recipe?.at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('answers both stock questions in one query each', async () => {
    setExtensionContributions(project.ctx, CONTRIBUTIONS);
    const open = await rows(project.ctx, stock('Extensions: open to contributions'));
    const ids = open.map((r) => r.point);
    expect(ids).toEqual(expect.arrayContaining(['skills', 'object-types', 'saved-queries', 'csl-styles']));
    expect(ids).not.toContain('mcp-servers');
    expect(ids).not.toContain('view-layouts');
    expect(Number(open.find((r) => r.point === 'skills')?.installed)).toBe(2);

    const byStock = await rows(project.ctx, stock('Extensions: what a contributor added'));
    expect(byStock.map((r) => r.contribution)).toEqual(['antithesize']);
  });

  it('never writes the catalog into graph.ttl — it is derived, and partly per machine', () => {
    setExtensionContributions(project.ctx, CONTRIBUTIONS);
    const persisted = serializeUserGraph(project.ctx);
    expect(persisted).not.toContain('ExtensionPoint');
    expect(persisted).not.toContain('x-minerva:contribution');
    expect(persisted).not.toContain('Files');
  });

  it('survives a full reindex, which resets the store', async () => {
    setExtensionContributions(project.ctx, CONTRIBUTIONS);
    await indexAllNotes(project.ctx);
    const found = await rows(project.ctx, 'SELECT ?id WHERE { ?c a minerva:Contribution ; dc:identifier ?id }');
    expect(found.map((r) => r.id).sort()).toEqual(['antithesize', 'my-skill', 'recipe', 'srv-1']);
  });

  it('rewrites only when what is installed changed', async () => {
    expect(setExtensionContributions(project.ctx, CONTRIBUTIONS)).toBe(true);
    expect(setExtensionContributions(project.ctx, [...CONTRIBUTIONS])).toBe(false);
    const fewer = CONTRIBUTIONS.slice(1);
    expect(setExtensionContributions(project.ctx, fewer)).toBe(true);
    const found = await rows(project.ctx, 'SELECT ?id WHERE { ?c a minerva:Contribution ; dc:identifier ?id }');
    expect(found.map((r) => r.id)).not.toContain('antithesize');
  });
});
