/**
 * Built-in Reading Queue views (#116). Date-relative semantics are
 * easiest to validate via a deterministic `now`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  indexSource,
  getReadingQueueSourceIds,
  getReadingQueueCounts,
} from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

function buildMeta(extra = ''): string {
  return `this: a thought:Article ;
    dc:title "Test" ;
${extra}    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;
}

describe('getReadingQueueSourceIds (#116)', () => {
  const project = useGraphProject('minerva-reading-queue-');
  let root: string;
  let ctx: ProjectContext;
  // Pin time so date-relative views are deterministic.
  const NOW = new Date('2026-05-27T00:00:00Z');

  beforeEach(() => {
    root = project.root;
    ctx = project.ctx;
  });

  function makeSource(id: string, ttlExtra = ''): void {
    const dir = path.join(root, '.minerva', 'sources', id);
    fs.mkdirSync(dir, { recursive: true });
    const ttl = buildMeta(ttlExtra);
    fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl);
    indexSource(ctx, id, ttl);
  }

  it('"unread" returns sources with no readStatus AND those marked unread', () => {
    makeSource('no-status'); // no status set
    makeSource('explicit-unread', '    minerva:readStatus "unread" ;\n');
    makeSource('reading', '    minerva:readStatus "reading" ;\n');

    expect(getReadingQueueSourceIds(ctx, 'unread', NOW).sort()).toEqual(['explicit-unread', 'no-status']);
  });

  it('"reading" returns only explicit readStatus = reading', () => {
    makeSource('a', '    minerva:readStatus "reading" ;\n');
    makeSource('b', '    minerva:readStatus "read" ;\n');
    makeSource('c'); // implicit unread doesn't match

    expect(getReadingQueueSourceIds(ctx, 'reading', NOW)).toEqual(['a']);
  });

  it('"dueThisWeek" includes due-today, future-within-7-days, and overdue', () => {
    makeSource('today', '    minerva:readDueBy "2026-05-27"^^xsd:date ;\n');
    makeSource('in-3-days', '    minerva:readDueBy "2026-05-30"^^xsd:date ;\n');
    makeSource('in-7-days', '    minerva:readDueBy "2026-06-03"^^xsd:date ;\n');
    makeSource('overdue', '    minerva:readDueBy "2026-05-20"^^xsd:date ;\n');
    makeSource('in-10-days', '    minerva:readDueBy "2026-06-06"^^xsd:date ;\n');
    makeSource('no-due-date'); // excluded — no due field

    expect(getReadingQueueSourceIds(ctx, 'dueThisWeek', NOW).sort()).toEqual([
      'in-3-days', 'in-7-days', 'overdue', 'today',
    ]);
  });

  it('"recentlyFinished" wants status=read AND modified within the last 30 days', () => {
    // mtime is set from the meta.ttl file's actual mtime, so to test
    // the date threshold we manually backdate one of the files.
    makeSource('just-finished', '    minerva:readStatus "read" ;\n');
    makeSource('old-read', '    minerva:readStatus "read" ;\n');
    // 60 days back — outside the 30-day window. Touch the file then
    // re-index so dc:modified reflects the backdated mtime.
    const old = new Date(NOW.getTime() - 60 * 86_400_000);
    fs.utimesSync(path.join(root, '.minerva', 'sources', 'old-read', 'meta.ttl'), old, old);
    indexSource(
      ctx,
      'old-read',
      fs.readFileSync(path.join(root, '.minerva', 'sources', 'old-read', 'meta.ttl'), 'utf-8'),
    );

    makeSource('reading-still', '    minerva:readStatus "reading" ;\n'); // wrong status

    expect(getReadingQueueSourceIds(ctx, 'recentlyFinished', NOW)).toEqual(['just-finished']);
  });

  it('returns an empty list when no sources match', () => {
    makeSource('a', '    minerva:readStatus "skipped" ;\n');
    expect(getReadingQueueSourceIds(ctx, 'reading', NOW)).toEqual([]);
    expect(getReadingQueueSourceIds(ctx, 'recentlyFinished', NOW)).toEqual([]);
    expect(getReadingQueueSourceIds(ctx, 'dueThisWeek', NOW)).toEqual([]);
  });

  it('handles malformed date literals gracefully (skips the source)', () => {
    makeSource('bad-date', '    minerva:readDueBy "next Tuesday" ;\n');
    makeSource('good-date', '    minerva:readDueBy "2026-05-30"^^xsd:date ;\n');

    expect(getReadingQueueSourceIds(ctx, 'dueThisWeek', NOW)).toEqual(['good-date']);
  });

  /**
   * #2222 — the sidebar's four queue rows show sizes, and getting them used to
   * mean four `SOURCES_QUEUE_MEMBERS` calls, each hydrating a full
   * `SourceMetadata[]` from the graph so the renderer could read `.length`.
   *
   * The property worth pinning is not "the counts are 2/1/1/0" in isolation —
   * it's that a count NEVER disagrees with the list a user gets when they click
   * that row. A fused-predicate reimplementation that drifts from
   * `getReadingQueueSourceIds` is the realistic regression, and it would show
   * up as a row reading "4" that opens onto three sources.
   */
  describe('getReadingQueueCounts (#2222)', () => {
    it('agrees with getReadingQueueSourceIds for every view', () => {
      makeSource('no-status');
      makeSource('explicit-unread', '    minerva:readStatus "unread" ;\n');
      makeSource('in-progress', '    minerva:readStatus "reading" ;\n');
      makeSource('finished', '    minerva:readStatus "read" ;\n');
      makeSource('due-soon', '    minerva:readDueBy "2026-05-30"^^xsd:date ;\n');

      const counts = getReadingQueueCounts(ctx, NOW);
      for (const view of ['unread', 'reading', 'dueThisWeek', 'recentlyFinished'] as const) {
        expect(counts[view], `count for ${view}`)
          .toBe(getReadingQueueSourceIds(ctx, view, NOW).length);
      }
      // Spot-check the absolute numbers too, so a mutual-agreement bug where
      // both sides return 0 can't pass this.
      expect(counts.unread).toBe(3); // no-status, explicit-unread, due-soon
      expect(counts.reading).toBe(1);
      expect(counts.recentlyFinished).toBe(1);
      expect(counts.dueThisWeek).toBe(1);
    });

    it('reports all-zero on an empty thoughtbase rather than omitting keys', () => {
      // The renderer renders `queueCounts[view]` straight into the row, so a
      // missing key would draw "undefined", not "0".
      expect(getReadingQueueCounts(ctx, NOW)).toEqual({
        unread: 0, reading: 0, dueThisWeek: 0, recentlyFinished: 0,
      });
    });
  });
});
