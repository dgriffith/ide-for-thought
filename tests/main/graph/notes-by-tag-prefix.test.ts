/**
 * `notesByTagPrefix` returns notes whose tags fall at-or-under a
 * given prefix (#466). Backs the parent-row click in the right-sidebar
 * tag tree — clicking `#projects` should surface every note tagged
 * `#projects`, `#projects/minerva`, `#projects/minerva/ui`, etc.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  indexNote,
  notesByTag,
  notesByTagPrefix,
} from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('notesByTagPrefix (#466)', () => {
  const project = useGraphProject('minerva-tag-prefix-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    ctx = project.ctx;

    await indexNote(ctx, 'a.md', '# A\n\n#projects/minerva/ui\n');
    await indexNote(ctx, 'b.md', '# B\n\n#projects/minerva/api\n');
    await indexNote(ctx, 'c.md', '# C\n\n#projects/lemur\n');
    await indexNote(ctx, 'd.md', '# D\n\n#unrelated\n');
    await indexNote(ctx, 'e.md', '# E\n\n#projects\n');
  });

  it('returns notes tagged exactly at the prefix and under it', () => {
    const result = notesByTagPrefix(ctx, 'projects');
    const paths = result.map((n) => n.relativePath).sort();
    expect(paths).toEqual(['a.md', 'b.md', 'c.md', 'e.md']);
  });

  it('a deeper prefix narrows the result set', () => {
    const result = notesByTagPrefix(ctx, 'projects/minerva');
    const paths = result.map((n) => n.relativePath).sort();
    expect(paths).toEqual(['a.md', 'b.md']);
  });

  it('a leaf prefix matches only the literal-tag note', () => {
    const result = notesByTagPrefix(ctx, 'projects/minerva/ui');
    expect(result.map((n) => n.relativePath)).toEqual(['a.md']);
  });

  it('does NOT match a sibling that shares the same opening segments', () => {
    // `projects/lemur` should NOT match a `projects/le` prefix that doesn't
    // align on the slash boundary — otherwise pre-leaf prefixes would
    // surface unrelated tags.
    const result = notesByTagPrefix(ctx, 'projects/le');
    expect(result).toEqual([]);
  });

  it('exact-tag lookup still works alongside the prefix variant', () => {
    const exact = notesByTag(ctx, 'projects/minerva/ui');
    expect(exact.map((n) => n.relativePath)).toEqual(['a.md']);
  });

  it('dedupes when one note carries multiple matching tags', async () => {
    await indexNote(ctx, 'multi.md', '# Multi\n\n#projects/minerva/ui #projects/minerva/api\n');
    const result = notesByTagPrefix(ctx, 'projects/minerva');
    const multiCount = result.filter((n) => n.relativePath === 'multi.md').length;
    expect(multiCount).toBe(1);
  });
});
