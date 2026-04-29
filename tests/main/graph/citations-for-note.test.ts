import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexNote,
  indexAllNotes,
  citationsForNote,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-citations-for-note-'));
}

function writeSource(root: string, id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl, 'utf-8');
}

function writeExcerpt(root: string, id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'excerpts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.ttl`), ttl, 'utf-8');
}

const SMITH_TTL = `
this: a thought:Article ;
  dc:title "On Knowledge Graphs" ;
  dc:creator "Smith, Alice" ;
  dc:issued "2023-07-15"^^xsd:date .
`;

const JONES_TTL = `
this: a thought:Book ;
  dc:title "On Programming" ;
  dc:creator "Jones, Bob" ;
  dc:issued "2018-04-01"^^xsd:date .
`;

const EX_42_TTL = `
this: a thought:Excerpt ;
  thought:fromSource sources:smith-2023 ;
  thought:citedText "Graphs are inherently relational." ;
  thought:page 42 .
`;

const EX_99_TTL = `
this: a thought:Excerpt ;
  thought:fromSource sources:smith-2023 ;
  thought:citedText "Edges encode meaning." ;
  thought:page 99 .
`;

describe('citationsForNote (#111)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
    writeSource(root, 'smith-2023', SMITH_TTL);
    writeSource(root, 'jones-2018', JONES_TTL);
    writeExcerpt(root, 'smith-2023-p42', EX_42_TTL);
    writeExcerpt(root, 'smith-2023-p99', EX_99_TTL);
    await indexAllNotes(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns nothing when the note has no cite/quote refs', async () => {
    const content = '# Plain note\n\nNo cites here.\n';
    fs.writeFileSync(path.join(root, 'plain.md'), content, 'utf-8');
    await indexNote(ctx, 'plain.md', content);
    const groups = citationsForNote(ctx, 'plain.md', content);
    expect(groups).toEqual([]);
  });

  it('aggregates a single source with title, year, byline, and count', async () => {
    const content = '# Note\n\nSee [[cite::smith-2023]] for details.\n';
    fs.writeFileSync(path.join(root, 'note.md'), content, 'utf-8');
    await indexNote(ctx, 'note.md', content);
    const groups = citationsForNote(ctx, 'note.md', content);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceId).toBe('smith-2023');
    expect(groups[0].title).toBe('On Knowledge Graphs');
    expect(groups[0].year).toBe('2023');
    expect(groups[0].creators).toEqual(['Smith, Alice']);
    expect(groups[0].citeCount).toBe(1);
    expect(groups[0].quoteCount).toBe(0);
    expect(groups[0].excerpts).toEqual([]);
  });

  it('counts repeated [[cite::id]] occurrences', async () => {
    const content = 'A [[cite::smith-2023]] then B [[cite::smith-2023]] and C [[cite::smith-2023]].\n';
    fs.writeFileSync(path.join(root, 'rep.md'), content, 'utf-8');
    await indexNote(ctx, 'rep.md', content);
    const groups = citationsForNote(ctx, 'rep.md', content);
    expect(groups).toHaveLength(1);
    expect(groups[0].citeCount).toBe(3);
  });

  it('groups quotes under their source and lists each excerpt with its locator', async () => {
    const content = '"x" [[quote::smith-2023-p42]] and "y" [[quote::smith-2023-p99]].\n';
    fs.writeFileSync(path.join(root, 'q.md'), content, 'utf-8');
    await indexNote(ctx, 'q.md', content);
    const groups = citationsForNote(ctx, 'q.md', content);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceId).toBe('smith-2023');
    expect(groups[0].citeCount).toBe(0);
    expect(groups[0].quoteCount).toBe(2);
    expect(groups[0].excerpts).toHaveLength(2);
    const exById = Object.fromEntries(groups[0].excerpts.map((e) => [e.excerptId, e]));
    expect(exById['smith-2023-p42'].page).toBe('42');
    expect(exById['smith-2023-p42'].quoteCount).toBe(1);
    expect(exById['smith-2023-p99'].page).toBe('99');
  });

  it('mixes cites and quotes that resolve to the same source under one row', async () => {
    const content = '[[cite::smith-2023]] and [[quote::smith-2023-p42]].\n';
    fs.writeFileSync(path.join(root, 'mix.md'), content, 'utf-8');
    await indexNote(ctx, 'mix.md', content);
    const groups = citationsForNote(ctx, 'mix.md', content);
    expect(groups).toHaveLength(1);
    expect(groups[0].citeCount).toBe(1);
    expect(groups[0].quoteCount).toBe(1);
    expect(groups[0].excerpts).toHaveLength(1);
  });

  it('orders most-cited first', async () => {
    const content =
      '[[cite::jones-2018]] and ' +
      '[[cite::smith-2023]] [[cite::smith-2023]] [[cite::smith-2023]].\n';
    fs.writeFileSync(path.join(root, 'order.md'), content, 'utf-8');
    await indexNote(ctx, 'order.md', content);
    const groups = citationsForNote(ctx, 'order.md', content);
    expect(groups.map((g) => g.sourceId)).toEqual(['smith-2023', 'jones-2018']);
  });

  it('ignores cite/quote occurrences inside a generated bibliography block', async () => {
    // Bibliography sections (#113) carry rendered text that may mention
    // "[[cite::other]]"-shaped strings; those shouldn't re-inflate the
    // count for sources the user no longer references in prose.
    const content =
      '[[cite::smith-2023]] in prose.\n\n' +
      '## References\n\n<!-- minerva:bibliography -->\n\n' +
      '[[cite::jones-2018]] (mentioned in entry text).\n\n' +
      '<!-- /minerva:bibliography -->\n';
    fs.writeFileSync(path.join(root, 'bib.md'), content, 'utf-8');
    await indexNote(ctx, 'bib.md', content);
    const groups = citationsForNote(ctx, 'bib.md', content);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceId).toBe('smith-2023');
  });
});
