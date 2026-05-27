/**
 * Broken-link inspection (#140). Three flavours: missing note,
 * missing anchor, unknown cite/quote id.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, indexSource, indexExcerpt } from '../../../src/main/graph/index';
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
