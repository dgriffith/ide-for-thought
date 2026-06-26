/**
 * Link-neighborhood traversal (#846).
 *
 * Two layers:
 *  - `walkNeighborhood` — the pure BFS, exercised over a hand-built adjacency
 *    (depth, cycle termination, node cap + truncation, edge dedup, source leaves).
 *  - `neighborhood` — end-to-end against a real indexed store (typed note links,
 *    backlinks, a cited source leaf, direction).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { walkNeighborhood, noteHop } from '../../../src/main/graph/neighborhood';
import { neighborhood } from '../../../src/main/graph/index';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import type { NeighborhoodNode, NeighborhoodHop } from '../../../src/shared/types';

const note = (id: string): NeighborhoodNode => ({ id, kind: 'note', label: id, exists: true });
const edge = (s: string, t: string, dir: 'out' | 'in' = 'out') => ({
  source: s, target: t, linkType: 'references', linkLabel: 'References', linkColor: '#fff', direction: dir,
});

/** Build a hop fn from an adjacency map of note → outgoing note ids. */
function hopFromAdjacency(adj: Record<string, string[]>): (id: string) => NeighborhoodHop {
  return (id) => {
    const outs = adj[id] ?? [];
    return {
      nodes: outs.map(note),
      edges: outs.map((o) => edge(id, o)),
      expandTo: outs,
    };
  };
}

describe('walkNeighborhood (pure BFS)', () => {
  it('reaches exactly the nodes within depth', () => {
    const hop = hopFromAdjacency({ a: ['b'], b: ['c'], c: ['d'] });
    const ids = (depth: number) => walkNeighborhood(note('a'), hop, { depth, cap: 100 }).nodes.map((n) => n.id).sort();
    expect(ids(1)).toEqual(['a', 'b']);
    expect(ids(2)).toEqual(['a', 'b', 'c']);
    expect(ids(3)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('terminates on a cycle via the visited-set', () => {
    const hop = hopFromAdjacency({ a: ['b'], b: ['a'] });
    const res = walkNeighborhood(note('a'), hop, { depth: 10, cap: 100 });
    expect(res.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(res.truncated).toBe(false);
  });

  it('caps the node count and reports truncation', () => {
    const hop = hopFromAdjacency({ a: ['b', 'c', 'd', 'e'] });
    const res = walkNeighborhood(note('a'), hop, { depth: 2, cap: 3 });
    expect(res.nodes).toHaveLength(3); // a + 2, then capped
    expect(res.truncated).toBe(true);
    // No edge points at a capped-out node.
    const ids = new Set(res.nodes.map((n) => n.id));
    for (const e of res.edges) { expect(ids.has(e.source)).toBe(true); expect(ids.has(e.target)).toBe(true); }
  });

  it('dedupes the same edge discovered from both endpoints', () => {
    // a → b (a's outgoing) and b sees a → b as an incoming edge.
    const hop = (id: string): NeighborhoodHop =>
      id === 'a' ? { nodes: [note('b')], edges: [edge('a', 'b', 'out')], expandTo: ['b'] }
        : id === 'b' ? { nodes: [note('a')], edges: [edge('a', 'b', 'in')], expandTo: ['a'] }
          : { nodes: [], edges: [], expandTo: [] };
    const res = walkNeighborhood(note('a'), hop, { depth: 3, cap: 100 });
    expect(res.edges).toHaveLength(1);
  });

  it('does not expand source leaves', () => {
    const hop = (id: string): NeighborhoodHop =>
      id === 'a'
        ? { nodes: [{ id: 'source:s1', kind: 'source', label: 'A Paper', exists: true }], edges: [edge('a', 'source:s1')], expandTo: [] }
        : { nodes: [note('should-not-appear')], edges: [], expandTo: ['should-not-appear'] };
    const res = walkNeighborhood(note('a'), hop, { depth: 5, cap: 100 });
    expect(res.nodes.map((n) => n.id).sort()).toEqual(['a', 'source:s1']);
  });
});

describe('neighborhood (against a real store)', () => {
  let root: string;
  let ctx: ProjectContext;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nbhd-test-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('walks outgoing + backlinks to depth, distinguishing nodes by kind', async () => {
    await indexNote(ctx, 'hub.md', '# Hub\n\nSee [[spoke]] and [[references::other]].');
    await indexNote(ctx, 'spoke.md', '# Spoke');
    await indexNote(ctx, 'other.md', '# Other');
    await indexNote(ctx, 'inbound.md', '# Inbound\n\nlinks to [[hub]]');

    const res = neighborhood(ctx, 'hub.md', { depth: 1 });
    const ids = res.nodes.map((n) => n.id).sort();
    expect(ids).toContain('hub.md');
    expect(ids).toContain('spoke.md');   // outgoing
    expect(ids).toContain('inbound.md'); // backlink
    expect(res.nodes.every((n) => n.kind === 'note')).toBe(true);
    // An edge from the backlink points into hub.
    expect(res.edges.some((e) => e.source === 'inbound.md' && e.target === 'hub.md')).toBe(true);
  });

  it('reaches depth-2 notes', async () => {
    await indexNote(ctx, 'a.md', 'see [[b]]');
    await indexNote(ctx, 'b.md', 'see [[c]]');
    await indexNote(ctx, 'c.md', '# C');
    const d1 = neighborhood(ctx, 'a.md', { depth: 1 }).nodes.map((n) => n.id);
    const d2 = neighborhood(ctx, 'a.md', { depth: 2 }).nodes.map((n) => n.id);
    expect(d1).not.toContain('c.md');
    expect(d2).toContain('c.md');
  });

  it('marks a wiki-link to a non-existent note as not existing', async () => {
    await indexNote(ctx, 'a.md', 'see [[ghost]]');
    const ghost = neighborhood(ctx, 'a.md', { depth: 1 }).nodes.find((n) => n.id === 'ghost.md' || n.label === 'ghost');
    expect(ghost?.exists).toBe(false);
  });

  it('includes a cited source as a leaf node (kind source), not expanded', async () => {
    await indexNote(ctx, 'a.md', 'As [[cite::smith-2023]] argues, and see [[b]].');
    await indexNote(ctx, 'b.md', '# B');
    const res = neighborhood(ctx, 'a.md', { depth: 2 });
    const source = res.nodes.find((n) => n.id === 'source:smith-2023');
    expect(source).toBeDefined();
    expect(source!.kind).toBe('source');
    // The cite edge runs a.md → the source.
    expect(res.edges.some((e) => e.source === 'a.md' && e.target === 'source:smith-2023' && e.linkType === 'cite')).toBe(true);
  });

  it('expandNode returns a single hop for on-demand growth', async () => {
    await indexNote(ctx, 'a.md', 'see [[b]] and [[c]]');
    await indexNote(ctx, 'b.md', '# B');
    await indexNote(ctx, 'c.md', '# C');
    const hop = noteHop(ctx, 'a.md');
    expect(hop.nodes.map((n) => n.id).sort()).toEqual(['b.md', 'c.md']);
    expect(hop.expandTo.sort()).toEqual(['b.md', 'c.md']);
  });
});
