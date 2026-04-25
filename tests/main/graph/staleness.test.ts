/**
 * dc:modified comes from disk mtime, not the indexer's wall clock (#336).
 *
 * Plant a file with a known-old mtime via fs.utimes, index it, and confirm
 * the staleness inspection picks it up. Before this fix, every reindex
 * stamped dc:modified to "now", so checkStaleness was always-empty theatre.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-staleness-test-'));
}

describe('dc:modified is sourced from disk mtime (#336)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('records the file system mtime as dc:modified, not the indexer time', async () => {
    const oldDate = new Date('2024-01-15T10:30:00Z');
    const filePath = path.join(root, 'old.md');
    await fsp.writeFile(filePath, '# Old note\nContent.\n', 'utf-8');
    await fsp.utimes(filePath, oldDate, oldDate);

    await indexNote(ctx, 'old.md', '# Old note\nContent.\n');

    const r = await queryGraph(ctx, `
      SELECT ?modified WHERE {
        ?n minerva:relativePath "old.md" ;
           dc:modified ?modified .
      }
    `);
    const rows = r.results as Array<{ modified: string }>;
    expect(rows).toHaveLength(1);
    // The Date may stringify with millisecond precision; compare on the
    // calendar-day prefix to avoid filesystem-specific mtime resolution.
    expect(rows[0].modified.startsWith('2024-01-15')).toBe(true);
  });

  it('staleness check fires for a note whose mtime is older than the threshold', async () => {
    const old = new Date(Date.now() - 60 * 86400000); // 60 days ago
    const fresh = new Date(Date.now() - 5 * 86400000); // 5 days ago

    const oldPath = path.join(root, 'old.md');
    const freshPath = path.join(root, 'fresh.md');
    await fsp.writeFile(oldPath, '# Old\nContent.\n', 'utf-8');
    await fsp.writeFile(freshPath, '# Fresh\nContent.\n', 'utf-8');
    await fsp.utimes(oldPath, old, old);
    await fsp.utimes(freshPath, fresh, fresh);

    await indexNote(ctx, 'old.md', '# Old\nContent.\n');
    await indexNote(ctx, 'fresh.md', '# Fresh\nContent.\n');

    // Default threshold inside checkStaleness is 30 days — old.md should
    // appear, fresh.md should not.
    const inspections = await runAllChecks(ctx);
    const stale = inspections.filter((i) => i.type === 'stale_note');
    const stalePaths = stale.map((s) => s.nodeLabel);
    expect(stalePaths).toContain('Old');
    expect(stalePaths).not.toContain('Fresh');
  });

  it('re-indexing the same content does not bump dc:modified to now', async () => {
    const oldDate = new Date('2024-03-01T08:00:00Z');
    const filePath = path.join(root, 'pinned.md');
    await fsp.writeFile(filePath, '# Pinned\n', 'utf-8');
    await fsp.utimes(filePath, oldDate, oldDate);

    // Initial index.
    await indexNote(ctx, 'pinned.md', '# Pinned\n');

    // A re-index — say from the open-project full scan, or a watcher
    // re-event — must NOT bump the timestamp to "now". The fs mtime
    // hasn't changed (we didn't write the file), so dc:modified must
    // stay anchored to 2024-03-01.
    await indexNote(ctx, 'pinned.md', '# Pinned\n');

    const r = await queryGraph(ctx, `
      SELECT ?modified WHERE {
        ?n minerva:relativePath "pinned.md" ;
           dc:modified ?modified .
      }
    `);
    const rows = r.results as Array<{ modified: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].modified.startsWith('2024-03-01')).toBe(true);
  });
});
