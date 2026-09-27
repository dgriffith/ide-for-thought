/**
 * The full-text index never reads through a symlink that leaves the
 * thoughtbase (#2398, follow-up to #2357). `indexAllNotes` walks with plain
 * `fs.readFile`, which follows links, and the index it builds is what the
 * LLM's search tool queries. In-root links keep indexing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, search, disposeProject } from '../../../src/main/search/index';
import { projectContext } from '../../../src/main/project-context-types';
import { useTempDir } from '../../helpers/temp-project';

const SECRET = 'topsecretxyzzy';

describe('search indexAllNotes and symlinks (#2398)', () => {
  const project = useTempDir('minerva-search-symlink-');
  const outside = useTempDir('minerva-search-outside-');
  const ctx = () => projectContext(project.root);

  // The index persists to `.minerva/search-index.json` at the end of a walk.
  beforeEach(() => { fs.mkdirSync(path.join(project.root, '.minerva')); });
  afterEach(() => { disposeProject(ctx()); });

  it('does not index a symlinked note whose target is outside the thoughtbase', async () => {
    fs.writeFileSync(path.join(outside.root, 'secret.md'), `# Secret\n\n${SECRET}\n`);
    fs.writeFileSync(path.join(project.root, 'ordinary.md'), '# Ordinary\n\nordinary words\n');
    fs.mkdirSync(path.join(project.root, 'sub'));
    fs.symlinkSync(path.join(outside.root, 'secret.md'), path.join(project.root, 'leak.md'));
    fs.symlinkSync(path.join(outside.root, 'secret.md'), path.join(project.root, 'sub', 'leak2.md'));
    // Dangling and escaping: used to throw ENOENT and abort the whole walk.
    fs.symlinkSync(path.join(outside.root, 'missing.md'), path.join(project.root, 'dangling.md'));

    const count = await indexAllNotes(ctx());

    expect(count).toBe(1);
    expect(await search(ctx(), SECRET)).toEqual([]);
    expect((await search(ctx(), 'ordinary')).map((r) => r.relativePath)).toEqual(['ordinary.md']);
  });

  it('still indexes a symlinked note whose target stays inside the thoughtbase', async () => {
    fs.writeFileSync(path.join(project.root, 'real.md'), '# Real\n\ninsideword\n');
    fs.symlinkSync('real.md', path.join(project.root, 'alias.md'));

    const count = await indexAllNotes(ctx());

    expect(count).toBe(2);
    const hits = (await search(ctx(), 'insideword')).map((r) => r.relativePath).sort();
    expect(hits).toEqual(['alias.md', 'real.md']);
  });
});
