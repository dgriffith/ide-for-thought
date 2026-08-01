/**
 * Backlinks panel surfaces frontmatter-originated links (broad option): every
 * inbound frontmatter edge shows up, with a label derived from the predicate
 * and a neutral colour that distinguishes it from typed body links.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, backlinks } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('backlinks — frontmatter links (broad)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-fm-backlinks-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    await indexNote(ctx, 'a.md', '# A');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('surfaces body AND frontmatter inbound links, labelled by their predicate', async () => {
    await indexNote(ctx, 'body.md', '# Body\n\n[[a]]');
    await indexNote(ctx, 'about.md', '---\nabout: "[[a]]"\n---\n# About\n');       // dc:subject
    await indexNote(ctx, 'see.md', '---\nsee-also: "[[a]]"\n---\n# See\n');        // thought:seeAlso
    await indexNote(ctx, 'custom.md', '---\nrelated: "[[a]]"\n---\n# Custom\n');   // minerva:meta-related

    const bySrc = new Map(backlinks(ctx, 'a.md').map((b) => [b.source, b]));

    // Body link keeps its typed badge.
    expect(bySrc.get('body.md')?.linkLabel).toBe('References');
    // Frontmatter links now appear (previously invisible), labelled from the key.
    expect(bySrc.get('about.md')?.linkLabel).toBe('Subject');
    expect(bySrc.get('see.md')?.linkLabel).toBe('See Also');
    expect(bySrc.get('custom.md')?.linkLabel).toBe('Related');
    // …with a neutral colour that reads distinctly from the typed body link.
    expect(bySrc.get('custom.md')?.linkColor).not.toBe(bySrc.get('body.md')?.linkColor);
  });

  it('shows a link-to-type edge with its ROLE, not a bare mention (#1073)', async () => {
    // Roadmap (a Project) has `owner: [[Alice]]` — a link-to-type property, so
    // Alice's backlinks surface the relation labelled by its role.
    await indexNote(ctx, 'Alice.md', '---\ntitle: Alice\ntype: person\n---\n# Alice\n');
    await indexNote(ctx, 'Roadmap.md', '---\ntitle: Roadmap\ntype: project\nowner: "[[Alice]]"\n---\n# Roadmap\n');
    const labels = backlinks(ctx, 'Alice.md').filter((b) => b.source === 'Roadmap.md').map((b) => b.linkLabel);
    // The relation surfaces WITH its role (via the types:owner edge), humanized.
    expect(labels).toContain('Owner');
  });

  it('never lists a note as its own backlink (body or frontmatter self-link)', async () => {
    await indexNote(ctx, 'self.md', '---\nrelated: "[[self]]"\n---\n# Self\n\n[[self]]');
    expect(backlinks(ctx, 'self.md').map((b) => b.source)).not.toContain('self.md');
  });

  it('only lists note sources — not source/tag/other nodes', async () => {
    // A plain integer property doesn't create an inbound edge; a wiki-link does.
    await indexNote(ctx, 'nolink.md', '---\nrating: 5\n---\n# NoLink\n');
    expect(backlinks(ctx, 'a.md').map((b) => b.source)).not.toContain('nolink.md');
  });
});
