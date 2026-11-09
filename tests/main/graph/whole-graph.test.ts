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

// Carried over from the per-note graph's tests when it was retired onto this graph (#3056).
describe('what each node and edge is (#3056, from #1142, #2957)', () => {
  it('a property edge carries the label the catalog gives it', async () => {
    await seed();
    const g = await wholeGraph(ctx);
    expect(g.edges.find((e) => e.source === 'events/Gig.md' && e.target === 'places/Lucerna.md')).toMatchObject({ linkType: 'property:location', linkLabel: 'Location' });
  });

  it('supports in both forms — a typed Claim\'s frontmatter and a Turtle block — is the one Supports kind', async () => {
    write('claims/Big.md', '---\ntype: claim\n---\n# Big claim\n');
    write('claims/Typed.md', '---\ntype: claim\nsupports: "[[Big]]"\n---\n# Typed support\n');
    await indexAllNotes(ctx);
    const { noteUriFor } = await import('../../../src/main/graph/index');
    write('claims/Turtle.md', ['# Turtle support', '', '```turtle', `<#c1> a thought:Claim ; thought:label "A hand-written reason" ; thought:supports <${noteUriFor(ctx, 'claims/Big.md')}> .`, '```', ''].join('\n'));
    await indexAllNotes(ctx);
    const g = await wholeGraph(ctx);
    expect(kinds(g, 'claims/Typed.md', 'claims/Big.md')).toEqual(['supports']);
    expect(kinds(g, 'claims/Turtle.md', 'claims/Big.md')).toEqual(['supports']);
    expect(g.edges.find((e) => e.linkType === 'supports')).toMatchObject({ linkLabel: 'Supports' });
  });

  it('a note typed thought:Term is a term', async () => {
    write('glossary/Semigroup.md', ['---', 'term: Semigroup', '---', '', '# Semigroup', '', '```turtle', 'this: a thought:Term .', '```', ''].join('\n'));
    write('notes/topic.md', '# Topic\n\nSee [[Semigroup]].\n');
    await indexAllNotes(ctx);
    const g = await wholeGraph(ctx);
    expect(g.nodes.find((n) => n.id === 'glossary/Semigroup.md')?.kind).toBe('term');
    expect(g.nodes.find((n) => n.id === 'notes/topic.md')?.kind).toBe('note');
  });

  it('a cited source is a node of its own, joined by a cite edge', async () => {
    write('a.md', 'As [[cite::smith-2023]] argues.\n');
    await indexAllNotes(ctx);
    const g = await wholeGraph(ctx);
    expect(g.nodes.find((n) => n.id === 'source:smith-2023')?.kind).toBe('source');
    expect(kinds(g, 'a.md', 'source:smith-2023')).toEqual(['cite']);
  });
});
