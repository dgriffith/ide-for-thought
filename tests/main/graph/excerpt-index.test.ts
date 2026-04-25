import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexNote,
  indexAllNotes,
  indexExcerpt,
  removeExcerpt,
  queryGraph,
  outgoingLinks,
  parseExcerptIdFromPath,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-excerpt-test-'));
}

function writeSourceMeta(root: string, id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl, 'utf-8');
}

function writeExcerpt(root: string, id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'excerpts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.ttl`), ttl, 'utf-8');
}

const SOURCE_TTL = `
this: a thought:Article ;
    dc:title "On the structure of knowledge graphs" ;
    dc:creator "Alice Smith" ;
    dc:issued "2023-07-15"^^xsd:date .
`;

const EXCERPT_TTL = `
this: a thought:Excerpt ;
    thought:fromSource sources:smith-2023 ;
    thought:citedText "Graphs are inherently relational." ;
    thought:page 42 ;
    thought:charStart 1234 ;
    thought:charEnd 1278 .
`;

describe('excerpt indexing (issue #92)', () => {
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

  it('indexAllNotes picks up hand-placed excerpts under .minerva/excerpts/', async () => {
    writeSourceMeta(root, 'smith-2023', SOURCE_TTL);
    writeExcerpt(root, 'smith-2023-p42', EXCERPT_TTL);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?id WHERE { ?ex minerva:excerptId ?id . }
    `);
    const ids = (results as Array<{ id: string }>).map(r => r.id);
    expect(ids).toEqual(['smith-2023-p42']);
  });

  it('resolves sources: prefix so thought:fromSource points at the Source URI', async () => {
    writeSourceMeta(root, 'smith-2023', SOURCE_TTL);
    writeExcerpt(root, 'smith-2023-p42', EXCERPT_TTL);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?title WHERE {
        ?ex minerva:excerptId "smith-2023-p42" ;
            thought:fromSource ?src .
        ?src minerva:sourceId "smith-2023" ;
             dc:title ?title .
      }
    `);
    const row = (results as Array<{ title: string }>)[0];
    expect(row?.title).toBe('On the structure of knowledge graphs');
  });

  it('stores structured location predicates on the excerpt', async () => {
    writeExcerpt(root, 'smith-2023-p42', EXCERPT_TTL);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?page ?charStart ?charEnd ?text WHERE {
        ?ex minerva:excerptId "smith-2023-p42" ;
            thought:page ?page ;
            thought:charStart ?charStart ;
            thought:charEnd ?charEnd ;
            thought:citedText ?text .
      } LIMIT 1
    `);
    const row = (results as Array<Record<string, string>>)[0];
    expect(row.page).toBe('42');
    expect(row.charStart).toBe('1234');
    expect(row.charEnd).toBe('1278');
    expect(row.text).toBe('Graphs are inherently relational.');
  });

  it('removeExcerpt drops the excerpt triples', async () => {
    writeExcerpt(root, 'smith-2023-p42', EXCERPT_TTL);
    await indexAllNotes(ctx);

    removeExcerpt(ctx, 'smith-2023-p42');
    const { results } = await queryGraph(ctx, `SELECT ?id WHERE { ?ex minerva:excerptId ?id . }`);
    expect(results).toHaveLength(0);
  });

  it('re-indexing an excerpt replaces its triples', async () => {
    writeExcerpt(root, 'smith-2023-p42', EXCERPT_TTL);
    await indexAllNotes(ctx);

    indexExcerpt(ctx, 'smith-2023-p42', `
      this: a thought:Excerpt ;
          thought:citedText "Revised quotation." .
    `);

    const { results } = await queryGraph(ctx, `
      SELECT ?text WHERE { ?ex minerva:excerptId "smith-2023-p42" ; thought:citedText ?text . }
    `);
    const texts = (results as Array<{ text: string }>).map(r => r.text);
    expect(texts).toEqual(['Revised quotation.']);
  });

  it('parseExcerptIdFromPath accepts canonical layout and rejects others', () => {
    expect(parseExcerptIdFromPath('.minerva/excerpts/smith-2023-p42.ttl')).toBe('smith-2023-p42');
    expect(parseExcerptIdFromPath('.minerva/excerpts/smith-2023-p42/meta.ttl')).toBeNull();
    expect(parseExcerptIdFromPath('.minerva/sources/foo/meta.ttl')).toBeNull();
    expect(parseExcerptIdFromPath('notes/foo.ttl')).toBeNull();
  });
});

describe('[[quote::excerpt-id]] link and graph walk', () => {
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

  it('writes a thought:quotes edge from the note to the excerpt URI', async () => {
    writeExcerpt(root, 'smith-2023-p42', EXCERPT_TTL);
    await indexAllNotes(ctx);

    await indexNote(ctx, 'argument.md', '# Argument\n\nAs [[quote::smith-2023-p42]] shows...');

    const { results } = await queryGraph(ctx, `
      SELECT ?ex WHERE {
        ?note minerva:relativePath "argument.md" .
        ?note thought:quotes ?ex .
        ?ex minerva:excerptId "smith-2023-p42" .
      }
    `);
    expect(results).toHaveLength(1);
  });

  it('walks claim → thought:quotes → excerpt → thought:fromSource → source', async () => {
    writeSourceMeta(root, 'smith-2023', SOURCE_TTL);
    writeExcerpt(root, 'smith-2023-p42', EXCERPT_TTL);
    await indexAllNotes(ctx);
    await indexNote(ctx, 'argument.md', '# Argument\n\n[[quote::smith-2023-p42]]');

    const { results } = await queryGraph(ctx, `
      SELECT ?sourceTitle ?citedText WHERE {
        ?note minerva:relativePath "argument.md" .
        ?note thought:quotes ?ex .
        ?ex thought:citedText ?citedText ;
            thought:fromSource ?src .
        ?src dc:title ?sourceTitle .
      }
    `);
    const row = (results as Array<{ sourceTitle: string; citedText: string }>)[0];
    expect(row.citedText).toBe('Graphs are inherently relational.');
    expect(row.sourceTitle).toBe('On the structure of knowledge graphs');
  });

  it('outgoingLinks reports the quote edge with linkType "quote"', async () => {
    writeExcerpt(root, 'smith-2023-p42', EXCERPT_TTL);
    await indexAllNotes(ctx);
    await indexNote(ctx, 'argument.md', '[[quote::smith-2023-p42]]');

    const links = outgoingLinks(ctx, 'argument.md');
    const quote = links.find(l => l.linkType === 'quote');
    expect(quote).toBeDefined();
    expect(quote!.exists).toBe(true);
  });
});
