/**
 * Reading queue (#116) — set/clear status + due-by on a source's
 * meta.ttl, then re-index so the graph reflects the change.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  setSourceReadStatus,
  setSourceReadDueBy,
  isReadStatus,
} from '../../../src/main/sources/read-status';
import { upsertSingleValuedPredicate } from '../../../src/main/sources/source-meta-write';
import {
  initGraph,
  indexSource,
  getSourceDetail,
  sourcesByReadStatus,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-read-status-'));
}

const META = `this: a thought:Article ;
    dc:title "Test paper" ;
    dc:creator "Alice" ;
    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;

describe('upsertSingleValuedPredicate', () => {
  it('inserts a fresh predicate line before the closing dot', () => {
    const out = upsertSingleValuedPredicate(META, 'minerva:readStatus', '"reading"');
    expect(out).toContain('minerva:readStatus "reading" ;');
    expect(out.indexOf('minerva:readStatus')).toBeLessThan(out.indexOf('thought:accessedAt'));
  });

  it('replaces an existing predicate value in place', () => {
    const withStatus = upsertSingleValuedPredicate(META, 'minerva:readStatus', '"unread"');
    const updated = upsertSingleValuedPredicate(withStatus, 'minerva:readStatus', '"reading"');
    expect(updated).toContain('minerva:readStatus "reading"');
    expect(updated).not.toContain('"unread"');
    // No duplicate predicate line.
    expect((updated.match(/minerva:readStatus/g) ?? []).length).toBe(1);
  });

  it('deletes a predicate line when value is null', () => {
    const withStatus = upsertSingleValuedPredicate(META, 'minerva:readStatus', '"reading"');
    const removed = upsertSingleValuedPredicate(withStatus, 'minerva:readStatus', null);
    expect(removed).not.toContain('minerva:readStatus');
    // The other predicates survive.
    expect(removed).toContain('dc:title');
    expect(removed).toContain('thought:accessedAt');
  });

  it('null-on-absent is a no-op', () => {
    const out = upsertSingleValuedPredicate(META, 'minerva:readStatus', null);
    expect(out).toBe(META);
  });

  it('preserves the indent of the existing predicate when replacing', () => {
    const initial = '    minerva:readStatus "unread" ;';
    const ttl = `this: a thought:Article ;\n${initial}\n    dc:title "X" .\n`;
    const out = upsertSingleValuedPredicate(ttl, 'minerva:readStatus', '"reading"');
    expect(out).toContain('    minerva:readStatus "reading" ;');
  });
});

describe('isReadStatus', () => {
  it('accepts the four valid values', () => {
    expect(isReadStatus('unread')).toBe(true);
    expect(isReadStatus('reading')).toBe(true);
    expect(isReadStatus('read')).toBe(true);
    expect(isReadStatus('skipped')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isReadStatus('UNREAD')).toBe(false);
    expect(isReadStatus('done')).toBe(false);
    expect(isReadStatus(null)).toBe(false);
    expect(isReadStatus(42)).toBe(false);
  });
});

describe('setSourceReadStatus (#116)', () => {
  let root: string;
  let ctx: ProjectContext;
  const sourceId = 'smith-2023';

  beforeEach(async () => {
    root = mkTemp();
    ctx = projectContext(root);
    await initGraph(ctx);
    const dir = path.join(root, '.minerva', 'sources', sourceId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.ttl'), META);
    indexSource(ctx, sourceId, META);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('writes the status to meta.ttl and reflects it in the graph', async () => {
    await setSourceReadStatus(root, sourceId, 'reading');

    const ttl = fs.readFileSync(path.join(root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
    expect(ttl).toContain('minerva:readStatus "reading"');

    const detail = getSourceDetail(ctx, sourceId);
    expect(detail?.metadata.readStatus).toBe('reading');
    expect(sourcesByReadStatus(ctx, 'reading').map((s) => s.sourceId)).toEqual([sourceId]);
  });

  it('changing the status removes the old triple from the graph', async () => {
    await setSourceReadStatus(root, sourceId, 'reading');
    await setSourceReadStatus(root, sourceId, 'read');

    const detail = getSourceDetail(ctx, sourceId);
    expect(detail?.metadata.readStatus).toBe('read');
    // The previous "reading" triple is gone.
    expect(sourcesByReadStatus(ctx, 'reading')).toEqual([]);
    expect(sourcesByReadStatus(ctx, 'read').map((s) => s.sourceId)).toEqual([sourceId]);
  });

  it('passing null clears the status', async () => {
    await setSourceReadStatus(root, sourceId, 'reading');
    await setSourceReadStatus(root, sourceId, null);

    const ttl = fs.readFileSync(path.join(root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
    expect(ttl).not.toContain('minerva:readStatus');

    const detail = getSourceDetail(ctx, sourceId);
    expect(detail?.metadata.readStatus).toBeNull();
    expect(sourcesByReadStatus(ctx, 'reading')).toEqual([]);
  });

  it('refuses an unknown status', async () => {
    // @ts-expect-error — test the runtime guard
    await expect(setSourceReadStatus(root, sourceId, 'done')).rejects.toThrow(/Invalid read status/);
  });
});

describe('setSourceReadDueBy (#116)', () => {
  let root: string;
  let ctx: ProjectContext;
  const sourceId = 'smith-2023';

  beforeEach(async () => {
    root = mkTemp();
    ctx = projectContext(root);
    await initGraph(ctx);
    const dir = path.join(root, '.minerva', 'sources', sourceId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.ttl'), META);
    indexSource(ctx, sourceId, META);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('writes a due date with xsd:date datatype and surfaces it in metadata', async () => {
    await setSourceReadDueBy(root, sourceId, '2026-06-30');

    const ttl = fs.readFileSync(path.join(root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
    expect(ttl).toContain('minerva:readDueBy "2026-06-30"^^xsd:date');

    const detail = getSourceDetail(ctx, sourceId);
    expect(detail?.metadata.readDueBy).toBe('2026-06-30');
  });

  it('refuses a non-ISO-date string', async () => {
    await expect(setSourceReadDueBy(root, sourceId, 'next Tuesday')).rejects.toThrow(/Invalid ISO date/);
  });

  it('passing null clears the date', async () => {
    await setSourceReadDueBy(root, sourceId, '2026-06-30');
    await setSourceReadDueBy(root, sourceId, null);
    const ttl = fs.readFileSync(path.join(root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
    expect(ttl).not.toContain('minerva:readDueBy');
  });
});
