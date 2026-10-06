/**
 * Tag merge / rename over a real temp thoughtbase (#2430).
 *
 * Real graph, real search index, real `notebase/fs` writes and real local
 * history — only the renderer-facing broadcast hooks are recorded. Covers the
 * issue's acceptance list end to end: notes (frontmatter, inline, nested),
 * sources (meta.ttl), the tag index after the merge, and the undo path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { useGraphProject } from '../../helpers/temp-project';
import * as graph from '../../../src/main/graph/index';
import { initSearch } from '../../../src/main/search/index';
import { writeFile, readFile } from '../../../src/main/notebase/fs';
import { parseMarkdown } from '../../../src/main/graph/parser';
import { listRevisions, getRevisionContent } from '../../../src/main/history/store';
import { mergeTag, mergeTagInMeta, previewTagMerge } from '../../../src/main/tags/merge-tags';
import type { WritePipelineHooks } from '../../../src/main/notebase/write-pipeline';

function recordingHooks() {
  const marked: string[] = [];
  const rewritten: string[][] = [];
  const hooks: WritePipelineHooks = {
    markPathHandled: (p) => { marked.push(p); },
    broadcastRewritten: (_root, paths) => { rewritten.push(paths); },
    broadcastHeadingRename: () => {},
  };
  return { hooks, marked, rewritten };
}

function metaTtl(id: string, tagLines: string[]): string {
  return [
    `<> a minerva:Source ;`,
    `    dc:title "Source ${id}" ;`,
    ...tagLines.map((l) => `    ${l} ;`),
    `    minerva:readStatus "unread" .`,
    '',
  ].join('\n');
}

describe('mergeTag over a temp thoughtbase (#2430)', () => {
  const project = useGraphProject('minerva-merge-tags-');

  async function note(rel: string, content: string): Promise<void> {
    await writeFile(project.root, rel, content);
    await graph.indexNote(project.ctx, rel, content);
  }

  async function source(id: string, tagLines: string[], body?: string): Promise<void> {
    const dir = path.join(project.root, '.minerva', 'sources', id);
    await fs.mkdir(dir, { recursive: true });
    const ttl = metaTtl(id, tagLines);
    await fs.writeFile(path.join(dir, 'meta.ttl'), ttl, 'utf-8');
    if (body !== undefined) await fs.writeFile(path.join(dir, 'body.md'), body, 'utf-8');
    graph.indexSource(project.ctx, id, ttl, body);
  }

  const tagNames = () => graph.listTags(project.ctx).map((t) => t.tag);

  beforeEach(async () => {
    await initSearch(project.ctx);
    await note('a.md', '---\ntags: [ml, stats]\n---\n# A\n\nAbout #ml/nlp.\n');
    await note('b.md', '---\ntags: [machine-learning, ml]\n---\nB body.\n');
    await note('c.md', '# C\n\nInline #ml and code `#ml`:\n\n```\n#ml\n```\nhttps://x.org/#ml\n');
    await note('d.md', '# D\n\n#mlops is unrelated, and so is #ML.\n');
    await source('s1', ['minerva:tag "ml"', 'minerva:tag "other"']);
    await source('s2', ['minerva:upstreamTag "ml/nlp"', 'minerva:tag "machine-learning/nlp"']);
    await source('s3', ['minerva:tag "other"'], 'Captured text mentions #ml.\n');
  });

  it('previews counts without writing anything', async () => {
    const before = await readFile(project.root, 'a.md');
    const preview = await previewTagMerge(project.root, 'ml', 'machine-learning');
    expect(preview).toEqual({
      notes: 3,
      sources: 2,
      sourcesBodyOnly: 1,
      nestedTags: ['ml/nlp'],
      isRename: false,
    });
    expect(await readFile(project.root, 'a.md')).toBe(before);
  });

  it('reports a rename when the target tag does not exist yet', async () => {
    const preview = await previewTagMerge(project.root, '#ml', 'learning');
    expect(preview.isRename).toBe(true);
  });

  it('moves frontmatter, inline, nested and source tags; the old tag leaves the index', async () => {
    const { hooks, marked } = recordingHooks();
    const result = await mergeTag(project.root, 'ml', 'machine-learning', hooks);

    expect(result.errors).toEqual([]);
    expect(result.notePaths.sort()).toEqual(['a.md', 'b.md', 'c.md']);
    expect(result.sourceIds.sort()).toEqual(['s1', 's2']);
    expect(marked.sort()).toEqual(['a.md', 'b.md', 'c.md']);

    // Notes on disk.
    const a = await readFile(project.root, 'a.md');
    expect(a).toContain('About #machine-learning/nlp.');
    expect(parseMarkdown(a).frontmatter.tags).toEqual(['machine-learning', 'stats']);
    // b.md already had the target: deduped, not duplicated.
    expect(parseMarkdown(await readFile(project.root, 'b.md')).frontmatter.tags).toEqual(['machine-learning']);
    // Code and URLs untouched.
    expect(await readFile(project.root, 'c.md'))
      .toBe('# C\n\nInline #machine-learning and code `#ml`:\n\n```\n#ml\n```\nhttps://x.org/#ml\n');
    // A note without the tag is not rewritten at all.
    expect(await readFile(project.root, 'd.md')).toBe('# D\n\n#mlops is unrelated, and so is #ML.\n');

    // Sources: user tag renamed; upstream nested tag moved (and deduped
    // against the user tag already there); unrelated tags kept.
    const s1 = await fs.readFile(path.join(project.root, '.minerva/sources/s1/meta.ttl'), 'utf-8');
    expect(s1).toContain('minerva:tag "machine-learning"');
    expect(s1).toContain('minerva:tag "other"');
    expect(s1).not.toMatch(/"ml"/);
    const s2 = await fs.readFile(path.join(project.root, '.minerva/sources/s2/meta.ttl'), 'utf-8');
    expect(s2.match(/machine-learning\/nlp/g)).toHaveLength(1);
    expect(s2).not.toContain('upstreamTag');

    // The graph. `ml` survives only via s3's captured text, which the merge
    // deliberately doesn't edit.
    const tags = tagNames();
    expect(tags).toContain('machine-learning');
    expect(tags).toContain('machine-learning/nlp');
    expect(tags).not.toContain('ml/nlp');
    expect(graph.notesByTag(project.ctx, 'ml')).toEqual([]);
    expect(graph.sourcesByTag(project.ctx, 'ml').map((s) => s.sourceId)).toEqual(['s3']);
    expect(graph.notesByTag(project.ctx, 'machine-learning').map((n) => n.relativePath).sort())
      .toEqual(['a.md', 'b.md', 'c.md']);
    expect(graph.sourcesByTag(project.ctx, 'machine-learning').map((s) => s.sourceId)).toEqual(['s1']);
    expect(tags).toContain('mlops');
    expect(tags).toContain('ML');
  });

  it('records each rewritten note in local history under the merge, so it can be undone', async () => {
    const original = await readFile(project.root, 'a.md');
    await mergeTag(project.root, 'ml', 'machine-learning', recordingHooks().hooks);
    const revs = await listRevisions(project.root, 'a.md');
    const merged = revs.find((r) => r.cause === 'Merged #ml into #machine-learning');
    expect(merged).toBeDefined();
    const older = revs.filter((r) => r.ts < merged!.ts);
    const contents = await Promise.all(older.map((r) => getRevisionContent(project.root, 'a.md', r.ts)));
    expect(contents).toContain(original);
  });

  it('is a no-op the second time — nothing left to move', async () => {
    await mergeTag(project.root, 'ml', 'machine-learning', recordingHooks().hooks);
    const again = await mergeTag(project.root, 'ml', 'machine-learning', recordingHooks().hooks);
    expect(again).toEqual({ notePaths: [], sourceIds: [], errors: [] });
  });

  it('renames a nested branch without touching its parent', async () => {
    await mergeTag(project.root, 'ml/nlp', 'nlp', recordingHooks().hooks);
    expect(await readFile(project.root, 'a.md')).toContain('About #nlp.');
    const a = parseMarkdown(await readFile(project.root, 'a.md'));
    expect(a.frontmatter.tags).toEqual(['ml', 'stats']);
    expect(tagNames()).toContain('ml');
    expect(tagNames()).not.toContain('ml/nlp');
  });

  it('refuses an invalid target and writes nothing', async () => {
    const before = await readFile(project.root, 'a.md');
    await expect(mergeTag(project.root, 'ml', 'machine learning', recordingHooks().hooks)).rejects.toThrow(/not a valid tag name/);
    await expect(previewTagMerge(project.root, 'ml', 'ml')).rejects.toThrow(/already called that/);
    expect(await readFile(project.root, 'a.md')).toBe(before);
  });

  it('keeps going past a note that vanished, and reports it', async () => {
    await fs.unlink(path.join(project.root, 'c.md')); // indexed, but gone from disk
    const result = await mergeTag(project.root, 'ml', 'machine-learning', recordingHooks().hooks);
    expect(result.notePaths.sort()).toEqual(['a.md', 'b.md']);
    expect(result.errors.map((e) => e.path)).toEqual(['c.md']);
  });
});

describe('mergeTagInMeta (pure)', () => {
  const ttl = metaTtl('x', ['minerva:tag "ml"', 'minerva:upstreamTag "ml/nlp"', 'minerva:tag "keep"']);

  it('moves user and upstream tag lines, keeping the file well-formed', () => {
    const r = mergeTagInMeta(ttl, ['ml', 'ml/nlp'], 'ml', 'ai');
    expect(r.changed).toBe(true);
    expect(r.ttl).toContain('minerva:tag "ai" ;');
    expect(r.ttl).toContain('minerva:tag "ai/nlp" ;');
    expect(r.ttl).toContain('minerva:tag "keep" ;');
    expect(r.ttl).not.toMatch(/"ml/);
    expect(r.ttl.trimEnd().endsWith('.')).toBe(true);
  });

  it('is unchanged when the source has none of the tags', () => {
    expect(mergeTagInMeta(ttl, ['zzz'], 'zzz', 'ai')).toEqual({ ttl, changed: false });
  });
});
