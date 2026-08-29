/**
 * Pre-flight reference check for Safe Delete (#429). All cases use
 * the live indexer + the real `findExternalInboundLinks` query —
 * no mocking — so any future change to LINK_TYPES, predicate
 * namespaces, or anchor handling continues to be exercised here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { indexNote, findExternalInboundLinks } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('safe-delete pre-flight (#429)', () => {
  const project = useGraphProject('minerva-safe-delete-');
  let ctx: ProjectContext;

  beforeEach(() => {
    ctx = project.ctx;
  });

  // ─── acceptance: standalone note with no inbound links ─────────────────

  it('returns no blockers when nothing links into the selection', async () => {
    await indexNote(ctx, 'orphan.md', '# Orphan\n\nNo one cites me.\n');
    const blockers = findExternalInboundLinks(ctx, ['orphan.md']);
    expect(blockers).toEqual([]);
  });

  // ─── acceptance: external linker blocks delete ─────────────────────────

  it('flags an external note that wiki-links into the selection', async () => {
    await indexNote(ctx, 'target.md', '# Target\n');
    await indexNote(ctx, 'other.md', '# Other\n\nSee [[target]] for context.\n');
    const blockers = findExternalInboundLinks(ctx, ['target.md']);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].target).toBe('target.md');
    expect(blockers[0].source).toBe('other.md');
    expect(blockers[0].sourceTitle).toBe('Other');
    expect(blockers[0].linkCount).toBeGreaterThanOrEqual(1);
  });

  it('captures the typed link-label when the inbound edge is typed', async () => {
    await indexNote(ctx, 'target.md', '# Target\n');
    await indexNote(ctx, 'other.md', '# Other\n\n[[supports::target]]\n');
    const blockers = findExternalInboundLinks(ctx, ['target.md']);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].linkLabel).toBe('Supports');
  });

  // ─── acceptance: closed loop within the selection deletes silently ────

  it('does not block when two notes only link to each other (closed loop)', async () => {
    await indexNote(ctx, 'a.md', '# A\n\nSee [[b]].\n');
    await indexNote(ctx, 'b.md', '# B\n\nSee [[a]].\n');
    const blockers = findExternalInboundLinks(ctx, ['a.md', 'b.md']);
    expect(blockers).toEqual([]);
  });

  it('still flags when only one of a pair points outward', async () => {
    await indexNote(ctx, 'a.md', '# A\n\nSee [[b]].\n');
    await indexNote(ctx, 'b.md', '# B\n\nNo outgoing.\n');
    await indexNote(ctx, 'outside.md', '# Outside\n\nSee [[a]].\n');
    const blockers = findExternalInboundLinks(ctx, ['a.md', 'b.md']);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].source).toBe('outside.md');
    expect(blockers[0].target).toBe('a.md');
  });

  // ─── acceptance: folder bundle with only-internal references deletes ──

  it('treats internal-only references inside a folder bundle as safe', async () => {
    await indexNote(ctx, 'topic/intro.md', '# Intro\n\nSee [[topic/details|details]].\n');
    await indexNote(ctx, 'topic/details.md', '# Details\n\nSee [[topic/intro]].\n');
    const blockers = findExternalInboundLinks(ctx, [
      'topic/intro.md',
      'topic/details.md',
    ]);
    expect(blockers).toEqual([]);
  });

  it('reports only the children that have outside referrers, not the whole folder', async () => {
    await indexNote(ctx, 'topic/intro.md', '# Intro\n');
    await indexNote(ctx, 'topic/details.md', '# Details\n');
    await indexNote(ctx, 'outside.md', '# Outside\n\nSee [[topic/details]].\n');
    const blockers = findExternalInboundLinks(ctx, [
      'topic/intro.md',
      'topic/details.md',
    ]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].target).toBe('topic/details.md');
    expect(blockers[0].source).toBe('outside.md');
  });

  // ─── multi-edge dedup ─────────────────────────────────────────────────

  it('dedupes multiple edges between the same source/target into one row with linkCount', async () => {
    await indexNote(ctx, 'target.md', '# Target\n');
    await indexNote(
      ctx,
      'other.md',
      '# Other\n\n[[target]] and again [[supports::target]] and once more [[target]].\n',
    );
    const blockers = findExternalInboundLinks(ctx, ['target.md']);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].linkCount).toBeGreaterThanOrEqual(2);
    // A typed predicate landed in pass A so the label should be preserved
    // (either `References` from the untyped [[target]] form or `Supports`
    // from the explicit `[[supports::target]]` — both are typed wiki-links;
    // first one through LINK_TYPES wins).
    expect(['References', 'Supports']).toContain(blockers[0].linkLabel);
  });

  // ─── anchored links ──────────────────────────────────────────────────

  it('flags anchored wiki-links (`[[target#heading]]`) as inbound references too', async () => {
    await indexNote(ctx, 'target.md', '# Target\n\n## Section\n');
    await indexNote(ctx, 'other.md', '# Other\n\n[[supports::target#section]]\n');
    const blockers = findExternalInboundLinks(ctx, ['target.md']);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].source).toBe('other.md');
  });

  // ─── ignores non-.md and unknown paths ───────────────────────────────

  it('skips non-.md paths in the input set', async () => {
    await indexNote(ctx, 'target.md', '# Target\n');
    await indexNote(ctx, 'other.md', '# Other\n\n[[target]]\n');
    // Pass a non-.md path alongside — it should be ignored, not throw.
    const blockers = findExternalInboundLinks(ctx, ['target.md', 'pics/diagram.png']);
    expect(blockers).toHaveLength(1);
  });

  it('returns empty when called with no paths', async () => {
    await indexNote(ctx, 'target.md', '# Target\n');
    await indexNote(ctx, 'other.md', '# Other\n\n[[target]]\n');
    expect(findExternalInboundLinks(ctx, [])).toEqual([]);
  });

  // ─── order ──────────────────────────────────────────────────────────

  it('orders rows by (target, source) for stable rendering', async () => {
    await indexNote(ctx, 'b.md', '# B\n');
    await indexNote(ctx, 'a.md', '# A\n');
    await indexNote(ctx, 'z.md', '# Z\n\n[[a]] [[b]]\n');
    await indexNote(ctx, 'x.md', '# X\n\n[[a]]\n');
    const blockers = findExternalInboundLinks(ctx, ['a.md', 'b.md']);
    // Expect a.md rows before b.md rows; within a.md, x then z.
    expect(blockers.map((b) => `${b.target} ← ${b.source}`)).toEqual([
      'a.md ← x.md',
      'a.md ← z.md',
      'b.md ← z.md',
    ]);
  });
});
