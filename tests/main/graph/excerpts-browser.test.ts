/**
 * The graph projection behind Excerpts-as-a-browsable-type (#1069): the count,
 * the list, and the three filters (by source, by source tag, by citing note).
 * Rides existing indexExcerpt — no data-model change.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-excerpts-');
let root: string;
let ctx: ProjectContext;

function writeSource(id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl, 'utf-8');
}
function writeExcerpt(id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'excerpts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.ttl`), ttl, 'utf-8');
}
function writeNote(rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}

beforeEach(async () => {
  root = project.root;
  ctx = project.ctx;

  writeSource('smith-2023', `this: a thought:Article ; dc:title "Smith 2023" ; minerva:tag "philosophy" .`);
  writeSource('jones-2024', `this: a thought:Article ; dc:title "Jones 2024" .`);
  writeExcerpt('smith-2023-a', `this: a thought:Excerpt ; thought:fromSource sources:smith-2023 ; thought:citedText "Being precedes essence." .`);
  writeExcerpt('jones-2024-a', `this: a thought:Excerpt ; thought:fromSource sources:jones-2024 ; thought:citedText "Nothing is fixed." .`);
  // A note that quotes the Smith excerpt.
  writeNote('Argument.md', `---\ntitle: Argument\n---\nSee [[quote::smith-2023-a]].\n`);
  await indexAllNotes(ctx);
});

const listQuery = (extra = '') =>
  `SELECT ?id ?text ?srcTitle WHERE {
     ?e a thought:Excerpt ; minerva:excerptId ?id ; thought:citedText ?text .
     OPTIONAL { ?e thought:fromSource ?src . OPTIONAL { ?src dc:title ?srcTitle } }
     ${extra}
   } ORDER BY ?text`;

async function ids(sparql: string): Promise<string[]> {
  const { results } = await queryGraph(ctx, sparql);
  return (results as Array<{ id: string }>).map((r) => r.id);
}

describe('excerpts browser projection (#1069)', () => {
  it('counts all excerpts', async () => {
    const { results } = await queryGraph(ctx, `SELECT (COUNT(?e) AS ?n) WHERE { ?e a thought:Excerpt }`);
    expect(Number((results as Array<{ n: string }>)[0]!.n)).toBe(2);
  });

  it('lists every excerpt with cited text + source title', async () => {
    const { results } = await queryGraph(ctx, listQuery());
    const rows = results as Array<{ id: string; text: string; srcTitle: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual(['jones-2024-a', 'smith-2023-a']);
    const smith = rows.find((r) => r.id === 'smith-2023-a')!;
    expect(smith.text).toContain('Being precedes essence');
    expect(smith.srcTitle).toBe('Smith 2023');
  });

  it('filters by source', async () => {
    expect(await ids(listQuery(`?e thought:fromSource ?fs . ?fs minerva:sourceId "smith-2023" .`))).toEqual(['smith-2023-a']);
  });

  it('filters by a source tag', async () => {
    expect(await ids(listQuery(`?e thought:fromSource ?ts . ?ts minerva:hasTag ?tt . ?tt minerva:tagName "philosophy" .`))).toEqual(['smith-2023-a']);
  });

  it('filters by citing note', async () => {
    expect(await ids(listQuery(`?fn thought:quotes ?e ; minerva:relativePath "Argument.md" .`))).toEqual(['smith-2023-a']);
  });
});
