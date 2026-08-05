/**
 * Broken-link inspection (#140). Three flavours: missing note,
 * missing anchor, unknown cite/quote id.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, indexSource, indexExcerpt, findNotesLinkingTo } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const SOURCE_META = `this: a thought:Article ;
    dc:title "A paper" ;
    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;

const EXCERPT_TTL = `this: a thought:Excerpt ;
    thought:fromSource sources:smith-2023 ;
    thought:citedText "..." .
`;

function writeSource(root: string, id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl);
}

describe('broken-link inspection (#140)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-broken-links-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });
  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  // ─── broken note link ───────────────────────────────────────────────────

  it('flags a [[missing-note]] wiki-link', async () => {
    await indexNote(ctx, 'a.md', '# A\n\nLinks to [[missing-note]] for context.\n');
    const inspections = await runAllChecks(ctx);
    const broken = inspections.filter((i) => i.type === 'broken_note_link');
    expect(broken).toHaveLength(1);
    expect(broken[0].message).toContain('missing-note');
    expect(broken[0].nodeLabel).toBe('a.md');
    expect(broken[0].severity).toBe('warning');
  });

  it('does not flag a link to an existing note', async () => {
    await indexNote(ctx, 'target.md', '# Target\n');
    await indexNote(ctx, 'source.md', '# S\n\n[[target]]\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_note_link')).toBe(false);
  });

  it('flags a typed broken link too (`[[supports::missing]]`)', async () => {
    await indexNote(ctx, 'a.md', '[[supports::missing-note]]\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_note_link')).toBe(true);
  });

  it('anchors the inspection to the referencing note via notePath (#1446)', async () => {
    // Used by the right-sidebar panel to scope inspections to the open note.
    await indexNote(ctx, 'topic/a.md', 'Links [[missing-note]].\n');
    const [broken] = (await runAllChecks(ctx)).filter((i) => i.type === 'broken_note_link');
    expect(broken.notePath).toBe('topic/a.md');
  });

  // ─── deterministic create-note fix (#1446) ──────────────────────────────

  it('carries a create-note fix targeting a path beside the referencing note', async () => {
    await indexNote(ctx, 'a.md', '# A\n\nLinks to [[missing-note]].\n');
    const [broken] = (await runAllChecks(ctx)).filter((i) => i.type === 'broken_note_link');
    expect(broken.fix).toEqual({ kind: 'create-note', label: 'Create Note', targetPath: 'missing-note.md' });
  });

  it('puts the create-note target in the referencing note\'s folder', async () => {
    await indexNote(ctx, 'topic/deep/a.md', '# A\n\n[[Concept X]]\n');
    const [broken] = (await runAllChecks(ctx)).filter((i) => i.type === 'broken_note_link');
    expect(broken.fix?.kind).toBe('create-note');
    expect(broken.fix && 'targetPath' in broken.fix ? broken.fix.targetPath : null).toBe('topic/deep/Concept X.md');
  });

  it('offers a remove-anchor fix on a broken anchor link (#1446)', async () => {
    await indexNote(ctx, 'target.md', '# Real heading\n\nbody\n');
    await indexNote(ctx, 'source.md', 'See [[target#missing-heading]]\n');
    const [broken] = (await runAllChecks(ctx)).filter((i) => i.type === 'broken_anchor_link');
    expect(broken.fix).toEqual({
      kind: 'remove-anchor',
      label: 'Remove anchor',
      notePath: 'source.md',
      targetPath: 'target.md',
      anchor: 'missing-heading',
    });
  });

  // ─── broken anchor link ─────────────────────────────────────────────────

  it('flags a [[note#missing-heading]] when the note exists but the heading does not', async () => {
    await indexNote(ctx, 'target.md', '# Real heading\n\nbody\n');
    await indexNote(ctx, 'source.md', '# S\n\nSee [[target#missing-heading]]\n');
    const inspections = await runAllChecks(ctx);
    const broken = inspections.filter((i) => i.type === 'broken_anchor_link');
    expect(broken).toHaveLength(1);
    expect(broken[0].message).toContain('missing-heading');
  });

  it('does not flag [[note#real-heading]] when the heading exists', async () => {
    await indexNote(ctx, 'target.md', '# Real heading\n\nbody\n');
    await indexNote(ctx, 'source.md', '[[target#real-heading]]\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_anchor_link')).toBe(false);
  });

  it('does not flag block-id anchors (`#^id`) — they\'re not in the graph', async () => {
    // Even if no `^id` exists in target.md, the inspection should
    // skip rather than false-flag.
    await indexNote(ctx, 'target.md', '# T\n\nplain body\n');
    await indexNote(ctx, 'source.md', '[[target#^somewhere]]\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_anchor_link')).toBe(false);
  });

  // ─── broken cite / quote ────────────────────────────────────────────────

  it('flags [[cite::unknown-source]]', async () => {
    await indexNote(ctx, 'a.md', '# A\n\nAs [[cite::unknown-source]] shows.\n');
    const inspections = await runAllChecks(ctx);
    const broken = inspections.filter((i) => i.type === 'broken_cite_quote');
    expect(broken).toHaveLength(1);
    expect(broken[0].message).toContain('unknown-source');
  });

  it('does not flag [[cite::known]] for a real source', async () => {
    writeSource(root, 'smith-2023', SOURCE_META);
    indexSource(ctx, 'smith-2023', SOURCE_META);
    await indexNote(ctx, 'a.md', '[[cite::smith-2023]]\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_cite_quote')).toBe(false);
  });

  it('flags [[quote::unknown-excerpt]]', async () => {
    await indexNote(ctx, 'a.md', '[[quote::unknown-excerpt]]\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_cite_quote')).toBe(true);
  });

  it('does not flag [[quote::known]] for a real excerpt', async () => {
    writeSource(root, 'smith-2023', SOURCE_META);
    indexSource(ctx, 'smith-2023', SOURCE_META);
    indexExcerpt(ctx, 'p42-graphs', EXCERPT_TTL);
    await indexNote(ctx, 'a.md', '[[quote::p42-graphs]]\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_cite_quote')).toBe(false);
  });
});

// ─── links to non-markdown notes (#1446) ────────────────────────────────────
describe('broken-link inspection — non-markdown note targets (#1446)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-nonmd-links-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });
  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('does not flag [[budget]] when a budget.csv note exists', async () => {
    await indexNote(ctx, 'budget.csv', 'month,spend\njan,10\n');
    await indexNote(ctx, 'a.md', 'See [[budget]] for the numbers.\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_note_link')).toBe(false);
  });

  it('does not flag links to .ttl or .py notes', async () => {
    await indexNote(ctx, 'data.ttl', '@prefix ex: <https://ex/> .\n');
    await indexNote(ctx, 'script.py', 'print("hi")\n');
    await indexNote(ctx, 'a.md', 'Links [[data]] and [[script]].\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_note_link')).toBe(false);
  });

  it('still flags a genuinely-missing note with a create-note fix to <stem>.md', async () => {
    await indexNote(ctx, 'budget.csv', 'month,spend\njan,10\n');
    await indexNote(ctx, 'a.md', '[[budget]] and [[ghost]]\n');
    const [broken] = (await runAllChecks(ctx)).filter((i) => i.type === 'broken_note_link');
    expect(broken.message).toContain('ghost');
    expect(broken.fix).toEqual({ kind: 'create-note', label: 'Create Note', targetPath: 'ghost.md' });
  });

  it('does not flag an anchor link to a non-md note (no markdown headings to check)', async () => {
    await indexNote(ctx, 'budget.csv', 'month,spend\njan,10\n');
    await indexNote(ctx, 'a.md', 'See [[budget#totals]]\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_anchor_link')).toBe(false);
    expect(inspections.some((i) => i.type === 'broken_note_link')).toBe(false);
  });

  it('records a backlink edge from a note that links a .csv note', async () => {
    await indexNote(ctx, 'budget.csv', 'month,spend\njan,10\n');
    await indexNote(ctx, 'a.md', 'See [[budget]].\n');
    expect(findNotesLinkingTo(ctx, 'budget.csv')).toContain('a.md');
  });

  it('resolves a non-md target indexed incrementally (no full rebuild)', async () => {
    // budget.csv is indexed on its own; a later single-note index of a.md must
    // still resolve [[budget]] against it (exercises the indexedNotePaths hoist).
    await indexNote(ctx, 'budget.csv', 'month,spend\njan,10\n');
    await indexNote(ctx, 'a.md', 'See [[budget]].\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'broken_note_link')).toBe(false);
    expect(findNotesLinkingTo(ctx, 'budget.csv')).toContain('a.md');
  });
});
