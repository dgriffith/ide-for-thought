/**
 * Search reads a CRLF note's frontmatter the way it reads an LF note's
 * (#2690). Search titles a note from `title:` through the graph's
 * `parseFrontmatter`, which was LF-only: a CRLF note fell back to its body H1
 * (or the filename) in search results, and through the full rebuild below.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initSearch, indexAllNotes, indexNote, search, disposeProject } from '../../../src/main/search/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { useTempDir } from '../../helpers/temp-project';

const LF_NOTE = [
  '---',
  'title: Meditations',
  'type: book',
  'tags: [stoicism]',
  'aliases: [Ta eis heauton]',
  'rating: 4',
  '---',
  '# A Heading That Is Not The Title',
  '',
  'twinmarker body text',
  '',
].join('\n');
const CRLF_NOTE = LF_NOTE.replace(/\n/g, '\r\n');

describe('search: CRLF frontmatter (#2690)', () => {
  const tmp = useTempDir('minerva-search-line-endings-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    fs.mkdirSync(path.join(tmp.root, '.minerva'), { recursive: true });
    ctx = projectContext(tmp.root);
    await initSearch(ctx);
  });
  afterEach(() => { disposeProject(ctx); });

  async function titles(): Promise<Array<[string, string]>> {
    return (await search(ctx, 'twinmarker'))
      .map((r) => [r.relativePath, r.title] as [string, string])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  it('titles a CRLF note from title:, exactly as its LF twin', async () => {
    indexNote(ctx, 'lf.md', LF_NOTE);
    indexNote(ctx, 'crlf.md', CRLF_NOTE);
    indexNote(ctx, 'bom.md', `\uFEFF${CRLF_NOTE}`);
    expect(await titles()).toEqual([['bom.md', 'Meditations'], ['crlf.md', 'Meditations'], ['lf.md', 'Meditations']]);
  });

  it('does the same through the full rebuild that runs on every open', async () => {
    fs.writeFileSync(path.join(tmp.root, 'lf.md'), LF_NOTE);
    fs.writeFileSync(path.join(tmp.root, 'crlf.md'), CRLF_NOTE);
    await indexAllNotes(ctx);
    expect(await titles()).toEqual([['crlf.md', 'Meditations'], ['lf.md', 'Meditations']]);
  });
});
