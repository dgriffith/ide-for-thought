/**
 * The whole thoughtbase as one graph (#2958): every note — orphans too — with
 * what the graph tab's filters read (folder, type, tags), every edge of every
 * kind (#2957), tags only when asked, and a ceiling that says when it was hit.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, wholeGraph } from '../../../src/main/graph/index';
import type { ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('whole-graph-');
let ctx: ProjectContext;
beforeEach(() => { ctx = project.ctx; });

const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(project.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(project.root, rel), content);
};
const kinds = (g: { edges: { source: string; target: string; linkType: string }[] }, s: string, t: string) =>
  g.edges.filter((e) => e.source === s && e.target === t).map((e) => e.linkType);

async function seed() {
  write('places/Lucerna.md', '---\ntype: place\n---\n# Lucerna\n\n#prague\n');
  write('events/Gig.md', '---\ntype: event\nlocation: "[[Lucerna]]"\n---\n# Gig\n\nSee [[Plan]] and [[Nowhere]].\n');
  write('Plan.md', '# Plan\n\n#prague\n');
  write('Lonely.md', '# Lonely\n');
  await indexAllNotes(ctx);
}

describe('wholeGraph (#2958)', () => {
  it('every note is a node, orphans too, carrying its folder, type and tags', async () => {
    await seed();
    const g = await wholeGraph(ctx);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['Lonely.md', 'Plan.md', 'events/Gig.md', 'places/Lucerna.md']);
    expect(g.nodes.find((n) => n.id === 'places/Lucerna.md')).toMatchObject({ label: 'Lucerna', folder: 'places', type: 'place', tags: ['prague'] });
    expect(g.nodes.find((n) => n.id === 'Plan.md')).toMatchObject({ folder: '', type: null });
    expect(g).toMatchObject({ total: 4, truncated: false });
  });

  it('draws every kind of edge once — a property, a body link — and no edge to a missing note', async () => {
    await seed();
    const g = await wholeGraph(ctx);
    expect(kinds(g, 'events/Gig.md', 'places/Lucerna.md')).toEqual(['property:location']); // not also `references`
    expect(kinds(g, 'events/Gig.md', 'Plan.md')).toEqual(['references']);
    expect(g.edges.some((e) => e.target.includes('Nowhere'))).toBe(false);
  });

  it('tags are nodes only when asked', async () => {
    await seed();
    expect((await wholeGraph(ctx)).nodes.some((n) => n.kind === 'tag')).toBe(false);
    const g = await wholeGraph(ctx, { tags: true });
    expect(g.nodes.filter((n) => n.kind === 'tag').map((n) => n.id)).toEqual(['tag:prague']);
    expect(kinds(g, 'Plan.md', 'tag:prague')).toEqual(['tag']);
    expect(kinds(g, 'places/Lucerna.md', 'tag:prague')).toEqual(['tag']);
  });

  it('past the ceiling it stops and says so, with no edge to a note it left out', async () => {
    await seed();
    const g = await wholeGraph(ctx, { ceiling: 2 });
    expect(g).toMatchObject({ total: 4, truncated: true });
    expect(g.nodes).toHaveLength(2);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) { expect(ids.has(e.source)).toBe(true); expect(ids.has(e.target)).toBe(true); }
  });
});
