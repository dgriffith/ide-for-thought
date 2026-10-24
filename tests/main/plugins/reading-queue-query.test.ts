/**
 * The Reading Queue's declared query (#2640), run against a real graph: it
 * names exactly the books and articles still to read or being read, reading
 * first, and `notePathsForIris` turns what it names into the session's scope.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, notePathsForIris, queryGraph } from '../../../src/main/graph/index';
import { useGraphProject } from '../../helpers/temp-project';

const QUERY = fs.readFileSync(path.resolve(import.meta.dirname, '../../../plugins/reading-queue/public/queue.rq'), 'utf8');

const NOTES: Record<string, string> = {
  'books/next.md': '---\ntype: book\nstatus: to-read\nauthor: Ann Author\n---\n# Next\n',
  'books/now.md': '---\ntype: book\nstatus: reading\n---\n# Now\n',
  'books/done.md': '---\ntype: book\nstatus: read\n---\n# Done\n',
  'articles/unread.md': '---\ntype: article\nread: unread\n---\n# Unread\n',
  'articles/finished.md': '---\ntype: article\nread: read\n---\n# Finished\n',
  // `status: to-read` on something that isn't a book doesn't queue it.
  'notes/untyped.md': '---\nstatus: to-read\n---\n# Untyped\n',
};

const project = useGraphProject('minerva-reading-queue-');

beforeEach(async () => {
  for (const [rel, content] of Object.entries(NOTES)) {
    const fp = path.join(project.root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, 'utf-8');
  }
  await indexAllNotes(project.ctx);
});

describe('the Reading Queue query (#2640)', () => {
  it('names the books and articles to read, reading first, and nothing else', async () => {
    const result = await queryGraph(project.ctx, QUERY);
    if (!result.ok) throw new Error(result.error);
    const rows = result.results as Array<Record<string, string>>;
    const paths = notePathsForIris(project.ctx, rows.map((r) => r.note!));
    expect(rows.map((r) => paths.get(r.note!))).toEqual(['books/now.md', 'books/next.md', 'articles/unread.md']);
    expect(rows.map((r) => r.kind)).toEqual(['book', 'book', 'article']);
    expect(rows.find((r) => paths.get(r.note!) === 'books/next.md')?.author).toBe('Ann Author');
  });
});

describe('notePathsForIris (#2640)', () => {
  it('maps note IRIs to their paths and leaves anything else out', async () => {
    const result = await queryGraph(project.ctx, 'SELECT ?n WHERE { ?n minerva:relativePath "books/now.md" }');
    if (!result.ok) throw new Error(result.error);
    const iri = (result.results[0] as { n: string }).n;
    const paths = notePathsForIris(project.ctx, [iri, 'https://example.org/not-a-note', 'plain text']);
    expect([...paths]).toEqual([[iri, 'books/now.md']]);
  });

  it('is empty for no IRIs', () => {
    expect(notePathsForIris(project.ctx, []).size).toBe(0);
  });
});
