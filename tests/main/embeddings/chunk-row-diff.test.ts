/**
 * The correctness half of #2217. `indexChunks` no longer rewrites every row of
 * a note on every autosave, which means something now has to be *right* about
 * which rows it skips — and the failure mode of getting it wrong is silent: a
 * stale row keeps matching semantic searches, or a heading shown beside a hit
 * describes a section the text no longer lives in.
 *
 * Every case below is a shape that a plausible-but-wrong diff gets wrong.
 */

import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '../../../src/main/embeddings/chunk';
import { planRowDiff, type StoredRow } from '../../../src/main/embeddings/chunk-row-diff';

const MODEL = 'test-model';

/** The rows a from-scratch index of `content` would have written. */
function storedFor(content: string, model = MODEL): StoredRow[] {
  return chunkMarkdown(content).map((c) => ({
    index: c.index, heading: c.heading, hash: c.hash, model,
  }));
}

const V1 = [
  '# Doc', '',
  '## Alpha', 'alpha body', '',
  '## Beta', 'beta body', '',
  '## Gamma', 'gamma body',
].join('\n');

describe('planRowDiff', () => {
  it('writes nothing when the content is unchanged', () => {
    const plan = planRowDiff(chunkMarkdown(V1), storedFor(V1), MODEL);
    expect(plan).toEqual({ deleteIndexes: [], write: [], fullReplace: false });
  });

  it('rewrites only the edited chunk', () => {
    const v2 = V1.replace('beta body', 'beta body EDITED');
    const plan = planRowDiff(chunkMarkdown(v2), storedFor(V1), MODEL);
    expect(plan.fullReplace).toBe(false);
    expect(plan.write.map((c) => c.index)).toEqual([2]);
    expect(plan.deleteIndexes).toEqual([2]);
  });

  it('rewrites descendant rows when an ANCESTOR heading is renamed', () => {
    // The sharp edge, and not the one you'd guess. `Chunk.hash` covers the
    // section's own lines — heading line included — so renaming a section's own
    // heading does change its hash. What the hash cannot see is the *breadcrumb*
    // stored in `section_heading`, which is built from the ancestor stack. Rename
    // the H1 and every H2 below it keeps a byte-identical body, an identical
    // hash, and a now-wrong breadcrumb — the column displayed beside every
    // search hit. A hash-keyed diff reports "nothing changed" here.
    const renamed = V1.replace('# Doc', '# Doc renamed');
    const before = chunkMarkdown(V1);
    const after = chunkMarkdown(renamed);
    for (const i of [1, 2, 3]) {
      expect(after[i]!.hash).toBe(before[i]!.hash);           // the trap,
      expect(after[i]!.heading).not.toBe(before[i]!.heading); // made explicit
    }

    const plan = planRowDiff(after, storedFor(V1), MODEL);
    expect(plan.write.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(plan.deleteIndexes).toEqual([0, 1, 2, 3]);
  });

  it('rewrites a sub-chunk whose heading changed but whose text did not', () => {
    // The other half: a section over `maxChars` is paragraph-split, and only the
    // FIRST sub-chunk carries the heading line. So sub-chunk 2+ has a hash that
    // does not cover its own heading either.
    const para = `${'word '.repeat(150)}\n\n${'other '.repeat(150)}`;
    const a = chunkMarkdown(`## Original\n${para}`);
    const b = chunkMarkdown(`## Retitled\n${para}`);
    expect(a.length).toBeGreaterThan(1);
    expect(b.at(-1)!.hash).toBe(a.at(-1)!.hash);
    expect(b.at(-1)!.heading).not.toBe(a.at(-1)!.heading);

    const plan = planRowDiff(b, storedFor(`## Original\n${para}`), MODEL);
    expect(plan.write.map((c) => c.index)).toEqual(a.map((c) => c.index));
  });

  it('deletes the rows past the end when the note gets shorter', () => {
    const shorter = ['# Doc', '', '## Alpha', 'alpha body'].join('\n');
    const plan = planRowDiff(chunkMarkdown(shorter), storedFor(V1), MODEL);
    expect(plan.write).toEqual([]);          // chunks 0 and 1 are untouched
    expect(plan.deleteIndexes).toEqual([2, 3]); // Beta and Gamma must go
  });

  it('rewrites every shifted row when a section is inserted at the top', () => {
    const shifted = V1.replace('## Alpha', '## New\nnew body\n\n## Alpha');
    const plan = planRowDiff(chunkMarkdown(shifted), storedFor(V1), MODEL);
    // Index 0 (the `# Doc` title section) is unmoved and survives; 1..3 all
    // slide down by one, and a 5th row appears.
    expect(plan.write.map((c) => c.index)).toEqual([1, 2, 3, 4]);
    expect(plan.deleteIndexes).toEqual([1, 2, 3]);
    expect(plan.fullReplace).toBe(false);
  });

  it('rewrites every row whose vector came from a different model', () => {
    const plan = planRowDiff(chunkMarkdown(V1), storedFor(V1, 'some-older-model'), MODEL);
    expect(plan.write).toHaveLength(4);
    expect(plan.deleteIndexes).toEqual([0, 1, 2, 3]);
  });

  it('falls back to a full replace when two stored rows share a chunk_index', () => {
    // Not reachable from this module's own writes; reachable from a store an
    // older build left behind. Deleting by index would remove one of the pair
    // and strand the other.
    const stored = storedFor(V1);
    const plan = planRowDiff(chunkMarkdown(V1), [...stored, { ...stored[1]!, hash: 'other' }], MODEL);
    expect(plan.fullReplace).toBe(true);
    expect(plan.write).toHaveLength(4);
    expect(plan.deleteIndexes).toEqual([]);
  });

  it('writes every chunk when nothing is stored yet', () => {
    const plan = planRowDiff(chunkMarkdown(V1), [], MODEL);
    expect(plan.write).toHaveLength(4);
    expect(plan.deleteIndexes).toEqual([]);
  });
});
