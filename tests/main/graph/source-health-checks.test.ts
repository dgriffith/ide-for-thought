/**
 * Source-related inspections (#119). Each check is shape-only —
 * no network — so the tests build a real graph state and run the
 * pass.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexSource, indexNote } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function buildMeta(extra = '', subtype = 'Article'): string {
  return `this: a thought:${subtype} ;
${extra}    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;
}

function makeSourceOnDisk(root: string, id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl);
}

describe('source health checks (#119)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-src-health-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });
  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  // ─── missing metadata ───────────────────────────────────────────────────

  it('flags sources missing dc:title', async () => {
    const ttl = buildMeta('    dc:creator "Alice" ;\n');
    makeSourceOnDisk(root, 'no-title', ttl);
    indexSource(ctx, 'no-title', ttl);
    const inspections = await runAllChecks(ctx);
    const missing = inspections.filter((i) => i.type === 'source_missing_metadata');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('title');
  });

  it('flags sources missing dc:creator', async () => {
    const ttl = buildMeta('    dc:title "Solo author piece" ;\n');
    makeSourceOnDisk(root, 'no-author', ttl);
    indexSource(ctx, 'no-author', ttl);
    const inspections = await runAllChecks(ctx);
    const missing = inspections.filter((i) => i.type === 'source_missing_metadata');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('authors');
  });

  it('does not flag a fully-populated source', async () => {
    const ttl = buildMeta('    dc:title "Complete" ;\n    dc:creator "Smith" ;\n');
    makeSourceOnDisk(root, 'ok', ttl);
    indexSource(ctx, 'ok', ttl);
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'source_missing_metadata')).toBe(false);
  });

  it('does not flag stubs for missing metadata (they\'re intentionally partial)', async () => {
    const ttl = buildMeta('    thought:stubStatus "unresolved" ;\n');
    makeSourceOnDisk(root, 'stub-1', ttl);
    indexSource(ctx, 'stub-1', ttl);
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'source_missing_metadata')).toBe(false);
  });

  // ─── long-unresolved stubs ──────────────────────────────────────────────

  it('flags stubs older than 30 days', async () => {
    const ttl = buildMeta('    dc:title "Aged stub" ;\n    thought:stubStatus "unresolved" ;\n');
    makeSourceOnDisk(root, 'aged-stub', ttl);
    indexSource(ctx, 'aged-stub', ttl);
    // dc:modified is sourced from the file's mtime; backdate so the
    // staleness check fires.
    const old = new Date(Date.now() - 45 * 86400000);
    fs.utimesSync(path.join(root, '.minerva', 'sources', 'aged-stub', 'meta.ttl'), old, old);
    indexSource(ctx, 'aged-stub', ttl);
    const inspections = await runAllChecks(ctx);
    const aged = inspections.filter((i) => i.type === 'stub_aged');
    expect(aged).toHaveLength(1);
    expect(aged[0].message).toContain('Aged stub');
    // Deterministic quick-fix: resolve the stub against CrossRef (#1446).
    expect(aged[0].fix).toEqual({ kind: 'resolve-source-stub', label: 'Resolve source', sourceId: 'aged-stub' });
  });

  it('does not flag freshly-created stubs', async () => {
    const ttl = buildMeta('    dc:title "Fresh stub" ;\n    thought:stubStatus "unresolved" ;\n');
    makeSourceOnDisk(root, 'fresh-stub', ttl);
    indexSource(ctx, 'fresh-stub', ttl);
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'stub_aged')).toBe(false);
  });

  // ─── cited but unread ───────────────────────────────────────────────────

  it('flags a source that\'s cited but has no readStatus', async () => {
    const ttl = buildMeta('    dc:title "Cited paper" ;\n    dc:creator "Smith" ;\n');
    makeSourceOnDisk(root, 'cited-paper', ttl);
    indexSource(ctx, 'cited-paper', ttl);
    await indexNote(ctx, 'note.md', '# Note\n\nSee [[cite::cited-paper]] for context.\n');
    const inspections = await runAllChecks(ctx);
    const flagged = inspections.filter((i) => i.type === 'source_cited_unread');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].nodeLabel).toBe('Cited paper');
    // Deterministic quick-fix: mark the cited source read (#1446).
    expect(flagged[0].fix).toEqual({ kind: 'set-read-status', label: 'Mark read', sourceId: 'cited-paper', status: 'read' });
  });

  it('does not flag a cited source that\'s marked reading', async () => {
    const ttl = buildMeta('    dc:title "Cited paper" ;\n    dc:creator "Smith" ;\n    minerva:readStatus "reading" ;\n');
    makeSourceOnDisk(root, 'cited-paper', ttl);
    indexSource(ctx, 'cited-paper', ttl);
    await indexNote(ctx, 'note.md', '[[cite::cited-paper]]\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'source_cited_unread')).toBe(false);
  });

  it('flags a cited source that\'s explicitly "unread"', async () => {
    const ttl = buildMeta('    dc:title "Cited paper" ;\n    dc:creator "Smith" ;\n    minerva:readStatus "unread" ;\n');
    makeSourceOnDisk(root, 'cited-paper', ttl);
    indexSource(ctx, 'cited-paper', ttl);
    await indexNote(ctx, 'note.md', '[[cite::cited-paper]]\n');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'source_cited_unread')).toBe(true);
  });

  // ─── duplicate DOI / URI ────────────────────────────────────────────────

  it('flags two sources sharing the same DOI (case-insensitive)', async () => {
    const a = buildMeta('    dc:title "A" ;\n    bibo:doi "10.1145/Foo" ;\n');
    const b = buildMeta('    dc:title "B" ;\n    bibo:doi "10.1145/foo" ;\n');
    makeSourceOnDisk(root, 'dup-a', a);
    makeSourceOnDisk(root, 'dup-b', b);
    indexSource(ctx, 'dup-a', a);
    indexSource(ctx, 'dup-b', b);
    const inspections = await runAllChecks(ctx);
    const dup = inspections.filter((i) => i.type === 'source_duplicate_doi');
    expect(dup).toHaveLength(1);
    expect(dup[0].message).toContain('dup-a');
    expect(dup[0].message).toContain('dup-b');
  });

  it('flags two sources sharing the same URL (trailing-slash normalised)', async () => {
    const a = buildMeta('    dc:title "A" ;\n    bibo:uri "https://example.com/x" ;\n');
    const b = buildMeta('    dc:title "B" ;\n    bibo:uri "https://example.com/x/" ;\n');
    makeSourceOnDisk(root, 'url-a', a);
    makeSourceOnDisk(root, 'url-b', b);
    indexSource(ctx, 'url-a', a);
    indexSource(ctx, 'url-b', b);
    const inspections = await runAllChecks(ctx);
    const dup = inspections.filter((i) => i.type === 'source_duplicate_uri');
    expect(dup).toHaveLength(1);
  });

  it('does not flag a single source with a unique DOI', async () => {
    const ttl = buildMeta('    dc:title "Solo" ;\n    dc:creator "Smith" ;\n    bibo:doi "10.1145/unique" ;\n');
    makeSourceOnDisk(root, 'solo', ttl);
    indexSource(ctx, 'solo', ttl);
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'source_duplicate_doi')).toBe(false);
  });
});
