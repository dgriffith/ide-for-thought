import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexNote,
  indexAllNotes,
  getSourceDetail,
  getExcerptSource,
} from '../../../src/main/graph/index';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-source-detail-test-'));
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

const ARTICLE_TTL = `
this: a thought:Article ;
    dc:title "On the structure of knowledge graphs" ;
    dc:creator "Alice Smith", "Bob Jones" ;
    dc:issued "2023-07-15"^^xsd:date ;
    dc:publisher "Example Press" ;
    dc:abstract "An abstract." ;
    bibo:doi "10.1234/ex.2023.1" ;
    bibo:uri <https://example.com/paper> .
`;

const EXCERPT_TTL = `
this: a thought:Excerpt ;
    thought:fromSource sources:smith-2023 ;
    thought:citedText "Graphs are relational." ;
    thought:page 42 .
`;

describe('getSourceDetail', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null for an unknown source id', async () => {
    await indexAllNotes(root);
    expect(getSourceDetail('nope')).toBeNull();
  });

  it('returns structured metadata including subtype, creators, DOI', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    await indexAllNotes(root);

    const detail = getSourceDetail('smith-2023');
    expect(detail).not.toBeNull();
    expect(detail!.metadata.sourceId).toBe('smith-2023');
    expect(detail!.metadata.subtype).toBe('Article');
    expect(detail!.metadata.title).toBe('On the structure of knowledge graphs');
    expect(detail!.metadata.creators.sort()).toEqual(['Alice Smith', 'Bob Jones']);
    expect(detail!.metadata.year).toBe('2023');
    expect(detail!.metadata.doi).toBe('10.1234/ex.2023.1');
    expect(detail!.metadata.uri).toBe('https://example.com/paper');
    expect(detail!.metadata.publisher).toBe('Example Press');
    expect(detail!.metadata.abstract).toBe('An abstract.');
  });

  it('lists excerpts that belong to the source', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    writeExcerpt(root, 'p42-graphs', EXCERPT_TTL);
    await indexAllNotes(root);

    const detail = getSourceDetail('smith-2023');
    expect(detail!.excerpts).toHaveLength(1);
    expect(detail!.excerpts[0].excerptId).toBe('p42-graphs');
    expect(detail!.excerpts[0].citedText).toBe('Graphs are relational.');
    expect(detail!.excerpts[0].page).toBe('42');
  });

  it('returns cite backlinks from notes with [[cite::id]]', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    await indexAllNotes(root);
    await indexNote('a.md', '# A\n\nAs [[cite::smith-2023]] shows...');
    await indexNote('b.md', '# B\n\nSee also [[cite::smith-2023]].');

    const detail = getSourceDetail('smith-2023');
    const cites = detail!.backlinks.filter(b => b.kind === 'cite');
    expect(cites.map(b => b.relativePath).sort()).toEqual(['a.md', 'b.md']);
  });

  it('returns quote backlinks via excerpts, carrying the excerpt id', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    writeExcerpt(root, 'p42-graphs', EXCERPT_TTL);
    await indexAllNotes(root);
    await indexNote('c.md', '# C\n\n[[quote::p42-graphs]]');

    const detail = getSourceDetail('smith-2023');
    const quotes = detail!.backlinks.filter(b => b.kind === 'quote');
    expect(quotes).toHaveLength(1);
    expect(quotes[0].relativePath).toBe('c.md');
    expect(quotes[0].viaExcerptId).toBe('p42-graphs');
  });
});

describe('getExcerptSource', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves an excerpt to its source id via thought:fromSource', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    writeExcerpt(root, 'p42-graphs', EXCERPT_TTL);
    await indexAllNotes(root);

    expect(getExcerptSource('p42-graphs')).toEqual({ sourceId: 'smith-2023' });
  });

  it('returns null for an unknown excerpt', async () => {
    await indexAllNotes(root);
    expect(getExcerptSource('nope')).toBeNull();
  });
});
