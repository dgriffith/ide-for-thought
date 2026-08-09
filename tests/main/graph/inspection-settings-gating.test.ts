/**
 * Settings actually gate the run (#1792).
 *
 * `runAllChecks` used to run all ten checks unconditionally at a hardcoded 30
 * days. Now it takes settings — and a toggle that doesn't change what comes
 * back is worse than no toggle, so this drives the real engine over a real
 * graph rather than asserting on the predicate in isolation.
 *
 * Both directions matter: a disabled check produces nothing, and the checks
 * around it keep working (a gate that quietly takes out its neighbours would
 * pass a test that only looked for absence).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, disposeProject } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { DEFAULT_INSPECTION_SETTINGS } from '../../../src/shared/inspections';

let root: string;
let ctx: ProjectContext;

/** A note last touched `days` ago, so the staleness check has something to find. */
async function seedOldNote(rel: string, body: string, days: number): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await fsp.utimes(abs, when, when);
  await indexNote(ctx, rel, body);
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-insp-gate-'));
  ctx = projectContext(root);
  await initGraph(ctx);
  // 60 days old, and pointing at a note that doesn't exist — one note that
  // trips both the staleness and the broken-link checks.
  await seedOldNote('old.md', '# Old\n\nSee [[nowhere-at-all]].\n', 60);
});
afterEach(async () => {
  disposeProject(ctx);
  await fsp.rm(root, { recursive: true, force: true });
});

const types = (list: { type: string }[]) => new Set(list.map((i) => i.type));

describe('runAllChecks — enabled set', () => {
  it('runs everything by default', async () => {
    const found = types(await runAllChecks(ctx));
    expect(found.has('stale_note')).toBe(true);
    expect(found.has('broken_note_link')).toBe(true);
  });

  it('drops a disabled check and leaves its neighbours alone', async () => {
    const found = types(await runAllChecks(ctx, {
      ...DEFAULT_INSPECTION_SETTINGS,
      disabled: ['stale_note'],
    }));
    expect(found.has('stale_note')).toBe(false);
    expect(found.has('broken_note_link')).toBe(true);
  });

  it('drops one type of a multi-type check without taking the others with it', async () => {
    // checkBrokenLinks emits three types from one pass; switching off the
    // note-link one must not silence heading or citation links.
    const found = types(await runAllChecks(ctx, {
      ...DEFAULT_INSPECTION_SETTINGS,
      disabled: ['broken_note_link'],
    }));
    expect(found.has('broken_note_link')).toBe(false);
    expect(found.has('stale_note')).toBe(true);
  });

  it('returns nothing when every visible check is off', async () => {
    const allOff = [
      'stale_note', 'broken_note_link', 'broken_anchor_link', 'broken_cite_quote',
      'source_missing_metadata', 'invalid_doi', 'source_duplicate_doi',
      'source_cited_unread', 'stub_aged',
    ];
    expect(await runAllChecks(ctx, { ...DEFAULT_INSPECTION_SETTINGS, disabled: allOff })).toEqual([]);
  });
});

describe('runAllChecks — thresholds', () => {
  it('honours a longer staleness window', async () => {
    // The note is 60 days old; at 90 days it isn't stale yet.
    const found = types(await runAllChecks(ctx, { ...DEFAULT_INSPECTION_SETTINGS, staleDays: 90 }));
    expect(found.has('stale_note')).toBe(false);
    expect(found.has('broken_note_link')).toBe(true);
  });

  it('honours a shorter one', async () => {
    const found = types(await runAllChecks(ctx, { ...DEFAULT_INSPECTION_SETTINGS, staleDays: 7 }));
    expect(found.has('stale_note')).toBe(true);
  });
});
