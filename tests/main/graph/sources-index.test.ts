import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexAllNotes,
  indexSource,
  removeSource,
  queryGraph,
  parseSourceIdFromPath,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-sources-test-'));
}

function writeSourceMeta(root: string, id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl, 'utf-8');
}

const ARTICLE_TTL = `
this: a thought:Article ;
    dc:title "On the structure of knowledge graphs" ;
    dc:creator "Alice Smith" ;
    dc:issued "2023-07-15"^^xsd:date ;
    bibo:doi "10.1038/s41586-023-0001-0" .
`;

const WEBPAGE_TTL = `
this: a thought:WebPage ;
    dc:title "Example page" ;
    dc:creator "Ada Lovelace" ;
    bibo:uri <https://example.com/page> .
`;

describe('source indexing (issue #89)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('indexAllNotes picks up hand-placed sources under .minerva/sources/', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    writeSourceMeta(root, 'example-page', WEBPAGE_TTL);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?id ?title WHERE {
        ?src minerva:sourceId ?id ; dc:title ?title .
      } ORDER BY ?id
    `);
    const rows = results as Array<{ id: string; title: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.id).sort()).toEqual(['example-page', 'smith-2023']);
  });

  it('stores the source subtype from meta.ttl', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?type WHERE {
        ?src minerva:sourceId "smith-2023" ; a ?type .
        FILTER(STRSTARTS(STR(?type), "https://minerva.dev/ontology/thought#"))
      }
    `);
    const types = (results as Array<{ type: string }>).map(r => r.type);
    expect(types).toContain('https://minerva.dev/ontology/thought#Article');
  });

  it('exposes source metadata (title, creator, doi) on the source node', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      PREFIX bibo: <http://purl.org/ontology/bibo/>
      SELECT ?title ?creator ?doi WHERE {
        ?src minerva:sourceId "smith-2023" .
        OPTIONAL { ?src dc:title ?title }
        OPTIONAL { ?src dc:creator ?creator }
        OPTIONAL { ?src bibo:doi ?doi }
      } LIMIT 1
    `);
    const row = (results as Array<{ title: string; creator: string; doi: string }>)[0];
    expect(row.title).toBe('On the structure of knowledge graphs');
    expect(row.creator).toBe('Alice Smith');
    expect(row.doi).toBe('10.1038/s41586-023-0001-0');
  });

  it('records relativePath pointing at .minerva/sources/<id>/meta.ttl', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?path WHERE { ?src minerva:sourceId "smith-2023" ; minerva:relativePath ?path . }
    `);
    const row = (results as Array<{ path: string }>)[0];
    expect(row.path).toBe('.minerva/sources/smith-2023/meta.ttl');
  });

  it('removeSource drops the source from the graph', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    await indexAllNotes(ctx);

    removeSource(ctx, 'smith-2023');
    const { results } = await queryGraph(ctx, `
      SELECT ?id WHERE { ?src minerva:sourceId ?id . }
    `);
    expect(results).toHaveLength(0);
  });

  it('re-indexing a source replaces its triples (no duplication)', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    await indexAllNotes(ctx);

    const updated = `
      this: a thought:Article ;
          dc:title "A revised title" ;
          dc:creator "Alice Smith" .
    `;
    indexSource(ctx, 'smith-2023', updated);

    const { results } = await queryGraph(ctx, `
      SELECT ?title WHERE { ?src minerva:sourceId "smith-2023" ; dc:title ?title . }
    `);
    const titles = (results as Array<{ title: string }>).map(r => r.title);
    expect(titles).toEqual(['A revised title']);
  });

  it('parseSourceIdFromPath accepts canonical layout and rejects others', () => {
    expect(parseSourceIdFromPath('.minerva/sources/smith-2023/meta.ttl')).toBe('smith-2023');
    expect(parseSourceIdFromPath('.minerva/sources/smith-2023/body.md')).toBeNull();
    expect(parseSourceIdFromPath('.minerva/sources/smith-2023/extra/meta.ttl')).toBeNull();
    expect(parseSourceIdFromPath('notes/meta.ttl')).toBeNull();
  });
});
