/**
 * Merge Sources command (#90 part 2).
 *
 * Spot-checks the major branches of mergeSources end-to-end on a temp
 * project, plus a few units on the helper exports.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph, indexSource, indexExcerpt, indexNote,
  listAllSources, excerptIdsForSource, findNotesCitingSource, getExcerptSource,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import {
  mergeSources,
  rewriteExcerptFromSource,
} from '../../../src/main/sources/merge-sources';

function mkTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-merge-sources-'));
}

function writeMeta(root: string, id: string, ttl: string): string {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl);
  return dir;
}

function writeExcerpt(root: string, id: string, ttl: string): string {
  const dir = path.join(root, '.minerva', 'excerpts');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.ttl`);
  fs.writeFileSync(filePath, ttl);
  return filePath;
}

function writeNote(root: string, relPath: string, content: string): void {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const minimalMeta = (title: string): string =>
  `this: a thought:Article ;\n    dc:title "${title}" ;\n    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .\n`;

describe('mergeSources (#90 part 2)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTemp();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('folds richer src metadata into dest, moves excerpts, rewrites cites, deletes src folder', async () => {
    const srcId = 'arxiv-1234.5678';
    const destId = 'doi-10.1-foo';

    const srcTtl = `this: a thought:Article ;\n    dc:title "The Paper" ;\n    dc:creator "Smith, J." ;\n    bibo:doi "10.1/foo" ;\n    dc:abstract "Abstract text." ;\n    dc:issued "2024-03-15"^^xsd:date ;\n    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .\n`;
    const destTtl = `this: a thought:Article ;\n    dc:title "The Paper (alt title)" ;\n    bibo:doi "10.1/foo" ;\n    thought:accessedAt "2026-05-02T00:00:00Z"^^xsd:dateTime .\n`;

    writeMeta(root, srcId, srcTtl);
    writeMeta(root, destId, destTtl);
    indexSource(ctx, srcId, srcTtl);
    indexSource(ctx, destId, destTtl);

    // Excerpt pointing at src.
    const excerptTtl = `this: a thought:Excerpt ;\n    thought:fromSource sources:${srcId} ;\n    thought:citedText "An excerpt." .\n`;
    writeExcerpt(root, 'ex-paper-claim', excerptTtl);
    indexExcerpt(ctx, 'ex-paper-claim', excerptTtl);

    // Note that cites src.
    writeNote(root, 'paper.md', 'See [[cite::' + srcId + ']] for context.\n');
    await indexNote(ctx, 'paper.md', 'See [[cite::' + srcId + ']] for context.\n');

    const result = await mergeSources(root, srcId, destId);

    expect(result.destId).toBe(destId);
    expect(result.removedId).toBe(srcId);
    expect(result.metadataAdded.sort()).toEqual(['abstract', 'creator', 'issued']);
    expect(result.excerptsMoved).toBe(1);
    expect(result.notesRewritten).toBe(1);

    // Dest meta gained the missing predicates but kept its existing title + doi.
    const destFinal = fs.readFileSync(path.join(root, '.minerva', 'sources', destId, 'meta.ttl'), 'utf-8');
    expect(destFinal).toContain('dc:title "The Paper (alt title)"');
    expect(destFinal).toContain('bibo:doi "10.1/foo"');
    expect(destFinal).toContain('dc:creator "Smith, J."');
    expect(destFinal).toContain('dc:abstract "Abstract text."');
    expect(destFinal).toContain('dc:issued');

    // Excerpt's fromSource was rewritten on disk.
    const excerptOnDisk = fs.readFileSync(path.join(root, '.minerva', 'excerpts', 'ex-paper-claim.ttl'), 'utf-8');
    expect(excerptOnDisk).toContain(`sources:${destId}`);
    expect(excerptOnDisk).not.toContain(`sources:${srcId}`);

    // Graph reflects the move.
    expect(excerptIdsForSource(ctx, srcId)).toEqual([]);
    expect(excerptIdsForSource(ctx, destId)).toEqual(['ex-paper-claim']);
    expect(getExcerptSource(ctx, 'ex-paper-claim')?.sourceId).toBe(destId);

    // Note was rewritten.
    const noteContent = fs.readFileSync(path.join(root, 'paper.md'), 'utf-8');
    expect(noteContent).toContain(`[[cite::${destId}]]`);
    expect(noteContent).not.toContain(`[[cite::${srcId}]]`);
    expect(findNotesCitingSource(ctx, srcId)).toEqual([]);
    expect(findNotesCitingSource(ctx, destId)).toEqual(['paper.md']);

    // src folder removed from disk + graph.
    expect(fs.existsSync(path.join(root, '.minerva', 'sources', srcId))).toBe(false);
    expect(listAllSources(ctx).some((s) => s.sourceId === srcId)).toBe(false);
  });

  it('copies body.md from src when dest lacks one, but never overwrites dest body', async () => {
    const srcId = 'src-a';
    const destId = 'src-b';
    writeMeta(root, srcId, minimalMeta('A'));
    writeMeta(root, destId, minimalMeta('B'));
    indexSource(ctx, srcId, minimalMeta('A'));
    indexSource(ctx, destId, minimalMeta('B'));

    await fsp.writeFile(path.join(root, '.minerva', 'sources', srcId, 'body.md'), '# Source A body\n');

    const result = await mergeSources(root, srcId, destId);

    expect(result.artifactsCopied).toContain('body.md');
    const destBody = fs.readFileSync(path.join(root, '.minerva', 'sources', destId, 'body.md'), 'utf-8');
    expect(destBody).toBe('# Source A body\n');
  });

  it('keeps dest body.md when both sources have one', async () => {
    const srcId = 'src-a';
    const destId = 'src-b';
    writeMeta(root, srcId, minimalMeta('A'));
    writeMeta(root, destId, minimalMeta('B'));
    indexSource(ctx, srcId, minimalMeta('A'));
    indexSource(ctx, destId, minimalMeta('B'));

    await fsp.writeFile(path.join(root, '.minerva', 'sources', srcId, 'body.md'), '# Source A body\n');
    await fsp.writeFile(path.join(root, '.minerva', 'sources', destId, 'body.md'), '# Source B body (preserved)\n');

    const result = await mergeSources(root, srcId, destId);

    expect(result.artifactsCopied).not.toContain('body.md');
    const destBody = fs.readFileSync(path.join(root, '.minerva', 'sources', destId, 'body.md'), 'utf-8');
    expect(destBody).toBe('# Source B body (preserved)\n');
  });

  it('copies original.pdf when dest lacks one', async () => {
    const srcId = 'src-a';
    const destId = 'src-b';
    writeMeta(root, srcId, minimalMeta('A'));
    writeMeta(root, destId, minimalMeta('B'));
    indexSource(ctx, srcId, minimalMeta('A'));
    indexSource(ctx, destId, minimalMeta('B'));
    await fsp.writeFile(path.join(root, '.minerva', 'sources', srcId, 'original.pdf'), Buffer.from('%PDF-1.4 test'));

    const result = await mergeSources(root, srcId, destId);

    expect(result.artifactsCopied).toContain('original.pdf');
    expect(fs.existsSync(path.join(root, '.minerva', 'sources', destId, 'original.pdf'))).toBe(true);
  });

  it('refuses to merge a source into itself', async () => {
    writeMeta(root, 'src-a', minimalMeta('A'));
    await expect(mergeSources(root, 'src-a', 'src-a')).rejects.toMatchObject({
      name: 'MergeSourcesError',
      code: 'same-source',
    });
  });

  it('errors with source-not-found when src is missing', async () => {
    writeMeta(root, 'src-b', minimalMeta('B'));
    await expect(mergeSources(root, 'src-missing', 'src-b')).rejects.toMatchObject({
      code: 'source-not-found',
    });
  });

  it('errors with dest-not-found when dest is missing', async () => {
    writeMeta(root, 'src-a', minimalMeta('A'));
    await expect(mergeSources(root, 'src-a', 'src-missing')).rejects.toMatchObject({
      code: 'dest-not-found',
    });
  });

  it('is a no-op merge (just folder removal) when src has no enriching metadata, no excerpts, no citing notes', async () => {
    const srcId = 'src-a';
    const destId = 'src-b';
    writeMeta(root, srcId, minimalMeta('A'));
    writeMeta(root, destId, minimalMeta('B'));
    indexSource(ctx, srcId, minimalMeta('A'));
    indexSource(ctx, destId, minimalMeta('B'));

    const result = await mergeSources(root, srcId, destId);

    expect(result.metadataAdded).toEqual([]);
    expect(result.excerptsMoved).toBe(0);
    expect(result.notesRewritten).toBe(0);
    expect(fs.existsSync(path.join(root, '.minerva', 'sources', srcId))).toBe(false);
    expect(fs.existsSync(path.join(root, '.minerva', 'sources', destId))).toBe(true);
  });
});

describe('rewriteExcerptFromSource', () => {
  it('rewrites a sources:srcId reference to sources:destId', () => {
    const ttl = 'this: a thought:Excerpt ;\n  thought:fromSource sources:foo ;\n  thought:citedText "..." .\n';
    const out = rewriteExcerptFromSource(ttl, 'foo', 'bar');
    expect(out).toContain('sources:bar');
    expect(out).not.toContain('sources:foo');
  });

  it('does not touch unrelated source ids that share a prefix', () => {
    const ttl = 'sources:foo ; sources:foobar .';
    const out = rewriteExcerptFromSource(ttl, 'foo', 'baz');
    expect(out).toContain('sources:baz');
    expect(out).toContain('sources:foobar');
  });

  it('returns the original when the srcId is not referenced', () => {
    const ttl = 'this: a thought:Excerpt ; thought:fromSource sources:other ; .';
    const out = rewriteExcerptFromSource(ttl, 'foo', 'bar');
    expect(out).toBe(ttl);
  });
});
