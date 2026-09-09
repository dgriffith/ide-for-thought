import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexNote, indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

function writeSourceMeta(root: string, id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl, 'utf-8');
}

function writeSourceBody(root: string, id: string, md: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'body.md'), md, 'utf-8');
}

const SOURCE_META = `
this: a thought:Article ;
    dc:title "Example paper" ;
    dc:creator "Alice Smith" .
`;

describe('SKOS tag alignment (#2034)', () => {
  const project = useGraphProject('minerva-skos-tag-test-');
  let root: string;
  let ctx: ProjectContext;

  beforeEach(() => {
    root = project.root;
    ctx = project.ctx;
  });

  it('types a note\'s tag as skos:Concept alongside minerva:Tag', async () => {
    await indexNote(ctx, 'note.md', '#research stuff\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?type WHERE {
        ?tag minerva:tagName "research" ; a ?type .
      }
    `);
    const types = (results as Array<{ type: string }>).map((r) => r.type);
    expect(types).toContain('https://minerva.dev/ontology#Tag');
    expect(types).toContain('http://www.w3.org/2004/02/skos/core#Concept');
  });

  it('sets skos:prefLabel to the same value as minerva:tagName, additively', async () => {
    await indexNote(ctx, 'note.md', '#research stuff\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?tagName ?prefLabel WHERE {
        ?tag minerva:tagName ?tagName ; skos:prefLabel ?prefLabel .
        FILTER(?tagName = "research")
      }
    `);
    expect(results).toEqual([{ tagName: 'research', prefLabel: 'research' }]);
  });

  it('links a note to its tag-Concept via dct:subject', async () => {
    await indexNote(ctx, 'note.md', '#research stuff\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?tag WHERE {
        ?note minerva:relativePath "note.md" ;
              dc:subject ?tag .
        ?tag minerva:tagName "research" .
      }
    `);
    expect((results as Array<{ tag: string }>).length).toBe(1);
  });

  it('gives a source\'s tag the same skos:Concept typing and dct:subject link', async () => {
    writeSourceMeta(root, 'smith-2023', SOURCE_META);
    writeSourceBody(root, 'smith-2023', '#research stuff\n');
    await indexAllNotes(ctx);

    const typeResults = await queryGraph(ctx, `
      SELECT ?type WHERE {
        ?tag minerva:tagName "research" ; a ?type .
      }
    `);
    const types = (typeResults.results as Array<{ type: string }>).map((r) => r.type);
    expect(types).toContain('http://www.w3.org/2004/02/skos/core#Concept');

    const linkResults = await queryGraph(ctx, `
      SELECT ?source WHERE {
        ?source dc:subject ?tag ; dc:title "Example paper" .
        ?tag minerva:tagName "research" .
      }
    `);
    expect((linkResults.results as Array<{ source: string }>).length).toBe(1);
  });
});
