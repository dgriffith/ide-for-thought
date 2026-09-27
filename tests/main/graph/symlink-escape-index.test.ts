/**
 * The full graph rebuild never reads through a symlink that leaves the
 * thoughtbase (#2398, follow-up to #2357).
 *
 * `indexAllNotes` walks the tree with `readdir` + plain `fs.readFile`, which
 * follows links and never passes `assertSafePath`. So `leak.md -> ~/.ssh/…`
 * used to land in the graph, where SPARQL and the LLM's tools read it. An
 * in-root link keeps indexing: that is a user's own note under two names.
 *
 * The "outside" directory is a second temp dir, a sibling of the project, so
 * it is outside the root for real rather than by spelling.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject, useTempDir } from '../../helpers/temp-project';

const SECRET = 'TOPSECRET-2398';

async function indexedPaths(ctx: ProjectContext): Promise<string[]> {
  const { results } = await queryGraph(ctx, `SELECT ?p WHERE { ?n a minerva:Note ; minerva:relativePath ?p . }`);
  return (results as Array<{ p: string }>).map((r) => r.p).sort();
}

async function graphMentions(ctx: ProjectContext, needle: string): Promise<boolean> {
  const { results } = await queryGraph(ctx, `
    SELECT ?o WHERE { ?s ?p ?o . FILTER(isLiteral(?o) && CONTAINS(STR(?o), "${needle}")) } LIMIT 1
  `);
  return results.length > 0;
}

describe('indexAllNotes and symlinks (#2398)', () => {
  const project = useGraphProject('minerva-symlink-index-');
  const outside = useTempDir('minerva-symlink-outside-');
  let root: string;
  let ctx: ProjectContext;

  beforeEach(() => {
    root = project.root;
    ctx = project.ctx;
    fs.writeFileSync(path.join(outside.root, 'secret.md'), `# ${SECRET}\n\nprivate body ${SECRET}\n`);
  });

  it('does not index a symlinked note whose target is outside the thoughtbase', async () => {
    fs.writeFileSync(path.join(root, 'ordinary.md'), '# Ordinary\n');
    fs.symlinkSync(path.join(outside.root, 'secret.md'), path.join(root, 'leak.md'));

    await indexAllNotes(ctx);

    expect(await indexedPaths(ctx)).toEqual(['ordinary.md']);
    expect(await graphMentions(ctx, SECRET)).toBe(false);
  });

  it('still indexes a symlinked note whose target stays inside the thoughtbase', async () => {
    fs.mkdirSync(path.join(root, 'notes'));
    fs.writeFileSync(path.join(root, 'notes', 'real.md'), '# Inside Title 2398\n');
    fs.symlinkSync(path.join(root, 'notes', 'real.md'), path.join(root, 'alias.md'));
    // A relative link target is the common shape from `ln -s`.
    fs.symlinkSync('real.md', path.join(root, 'notes', 'relative-alias.md'));

    await indexAllNotes(ctx);

    expect(await indexedPaths(ctx)).toEqual(['alias.md', 'notes/real.md', 'notes/relative-alias.md']);
  });

  it('skips an escaping link in a subfolder and a dangling escaping link without failing the rebuild', async () => {
    fs.mkdirSync(path.join(root, 'deep', 'er'), { recursive: true });
    fs.symlinkSync(path.join(outside.root, 'secret.md'), path.join(root, 'deep', 'er', 'leak.md'));
    // Dangling: the target doesn't exist. Before #2398 the main pass's
    // readFile threw ENOENT here and aborted the whole rebuild.
    fs.symlinkSync(path.join(outside.root, 'nope.md'), path.join(root, 'dangling.md'));
    fs.writeFileSync(path.join(root, 'kept.md'), '# Kept\n');

    const count = await indexAllNotes(ctx);

    expect(count).toBe(1);
    expect(await indexedPaths(ctx)).toEqual(['kept.md']);
    expect(await graphMentions(ctx, SECRET)).toBe(false);
  });

  it('reports progress totals that match what was indexed', async () => {
    fs.writeFileSync(path.join(root, 'a.md'), '# A\n');
    fs.symlinkSync(path.join(outside.root, 'secret.md'), path.join(root, 'leak.md'));
    const ticks: Array<[number, number]> = [];

    await indexAllNotes(ctx, { onProgress: (done, total) => ticks.push([done, total]) });

    expect(ticks).toEqual([[1, 1]]);
  });

  it('does not index a source whose meta.ttl links outside the thoughtbase', async () => {
    const meta = `this: a thought:Article ;\n    dc:title "${SECRET} source" .\n`;
    fs.writeFileSync(path.join(outside.root, 'meta.ttl'), meta);
    const leaked = path.join(root, '.minerva', 'sources', 'leaked');
    fs.mkdirSync(leaked, { recursive: true });
    fs.symlinkSync(path.join(outside.root, 'meta.ttl'), path.join(leaked, 'meta.ttl'));
    // Control: the same metadata as a real in-root file does index.
    const real = path.join(root, '.minerva', 'sources', 'real');
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, 'meta.ttl'), `this: a thought:Article ;\n    dc:title "Real source" .\n`);

    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `SELECT ?id WHERE { ?s minerva:sourceId ?id . }`);
    expect((results as Array<{ id: string }>).map((r) => r.id)).toEqual(['real']);
    expect(await graphMentions(ctx, SECRET)).toBe(false);
  });

  it('does not read excerpts through a .minerva/excerpts directory that links outside', async () => {
    fs.writeFileSync(
      path.join(outside.root, 'ex1.ttl'),
      `this: a thought:Excerpt ;\n    thought:citedText "${SECRET} quote" .\n`,
    );
    fs.mkdirSync(path.join(root, '.minerva'), { recursive: true });
    fs.rmSync(path.join(root, '.minerva', 'excerpts'), { recursive: true, force: true });
    fs.symlinkSync(outside.root, path.join(root, '.minerva', 'excerpts'));

    await indexAllNotes(ctx);

    expect(await graphMentions(ctx, SECRET)).toBe(false);
  });
});
