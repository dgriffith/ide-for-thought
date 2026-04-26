import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexAllNotes,
  findNotesCitingSource,
  findNotesQuotingExcerpt,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { renameSource, renameExcerpt } from '../../../src/main/notebase/rename-source-excerpt';
import { rewriteTypedIdLinks } from '../../../src/main/notebase/link-rewriting';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-src-rename-test-'));
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

function writeNote(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function readNote(root: string, relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf-8');
}

const SOURCE_TTL = `
this: a thought:Article ;
    dc:title "A paper" ;
    dc:creator "Ada Lovelace" .
`;

const EXCERPT_TTL = `
this: a thought:Excerpt ;
    thought:fromSource sources:smith-2023 ;
    thought:citedText "Graphs are relational." ;
    thought:page 42 .
`;

describe('renameSource (issue #141)', () => {
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

  it('renames the directory on disk and rewrites every [[cite::oldId]]', async () => {
    writeSourceMeta(root, 'smith-2023', SOURCE_TTL);
    writeNote(root, 'a.md', 'As [[cite::smith-2023]] argues...');
    writeNote(root, 'b.md', '[[cite::smith-2023|see the paper]] and [[cite::other-2020]]');
    await indexAllNotes(ctx);

    const { rewrittenPaths } = await renameSource(root, 'smith-2023', 'lovelace-2023');

    expect(fs.existsSync(path.join(root, '.minerva/sources/smith-2023'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.minerva/sources/lovelace-2023/meta.ttl'))).toBe(true);

    expect(readNote(root, 'a.md')).toContain('[[cite::lovelace-2023]]');
    expect(readNote(root, 'b.md')).toContain('[[cite::lovelace-2023|see the paper]]');
    expect(readNote(root, 'b.md')).toContain('[[cite::other-2020]]'); // untouched
    expect(rewrittenPaths.sort()).toEqual(['a.md', 'b.md']);
  });

  it('shifts the graph so new id is citable and old id isn\'t', async () => {
    writeSourceMeta(root, 'smith-2023', SOURCE_TTL);
    writeNote(root, 'a.md', 'As [[cite::smith-2023]] argues...');
    await indexAllNotes(ctx);

    await renameSource(root, 'smith-2023', 'lovelace-2023');

    expect(findNotesCitingSource(ctx, 'smith-2023')).toEqual([]);
    expect(findNotesCitingSource(ctx, 'lovelace-2023')).toEqual(['a.md']);
  });

  it('no-ops when oldId equals newId', async () => {
    writeSourceMeta(root, 'smith-2023', SOURCE_TTL);
    await indexAllNotes(ctx);
    const { rewrittenPaths } = await renameSource(root, 'smith-2023', 'smith-2023');
    expect(rewrittenPaths).toEqual([]);
  });
});

describe('renameExcerpt (issue #141)', () => {
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

  it('renames the .ttl file and rewrites every [[quote::oldId]]', async () => {
    writeSourceMeta(root, 'smith-2023', SOURCE_TTL);
    writeExcerpt(root, 'p42', EXCERPT_TTL);
    writeNote(root, 'a.md', '[[quote::p42]]');
    writeNote(root, 'b.md', '[[quote::p42|on page 42]] and [[quote::other]]');
    await indexAllNotes(ctx);

    const { rewrittenPaths } = await renameExcerpt(root, 'p42', 'graphs-relational');

    expect(fs.existsSync(path.join(root, '.minerva/excerpts/p42.ttl'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.minerva/excerpts/graphs-relational.ttl'))).toBe(true);

    expect(readNote(root, 'a.md')).toContain('[[quote::graphs-relational]]');
    expect(readNote(root, 'b.md')).toContain('[[quote::graphs-relational|on page 42]]');
    expect(readNote(root, 'b.md')).toContain('[[quote::other]]');
    expect(rewrittenPaths.sort()).toEqual(['a.md', 'b.md']);
  });

  it('shifts the graph so new id is the quote target', async () => {
    writeSourceMeta(root, 'smith-2023', SOURCE_TTL);
    writeExcerpt(root, 'p42', EXCERPT_TTL);
    writeNote(root, 'a.md', '[[quote::p42]]');
    await indexAllNotes(ctx);

    await renameExcerpt(root, 'p42', 'graphs-relational');

    expect(findNotesQuotingExcerpt(ctx, 'p42')).toEqual([]);
    expect(findNotesQuotingExcerpt(ctx, 'graphs-relational')).toEqual(['a.md']);
  });
});

describe('rewriteTypedIdLinks (pure, #141)', () => {
  it('only rewrites the requested link type', () => {
    const out = rewriteTypedIdLinks(
      '[[cite::a]] and [[quote::a]] and [[supports::a]]',
      'cite',
      new Map([['a', 'b']]),
    );
    expect(out).toBe('[[cite::b]] and [[quote::a]] and [[supports::a]]');
  });

  it('preserves display text', () => {
    const out = rewriteTypedIdLinks('[[cite::a|see paper]]', 'cite', new Map([['a', 'b']]));
    expect(out).toBe('[[cite::b|see paper]]');
  });

  it('leaves unrecognized ids alone', () => {
    const out = rewriteTypedIdLinks('[[cite::a]] [[cite::c]]', 'cite', new Map([['a', 'b']]));
    expect(out).toBe('[[cite::b]] [[cite::c]]');
  });
});
