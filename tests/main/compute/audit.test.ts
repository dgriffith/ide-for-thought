/**
 * Compute execution audit log (#1413).
 *
 * Records live per-machine under `app.getPath('userData')` (stubbed to a temp
 * dir, same trick as consent.test / python-settings.test), one JSON line each.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CellResult } from '../../../src/shared/compute/types';

let userDataDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`);
      return userDataDir;
    },
  },
}));

import { recordExecution, readAuditLog, auditLogPath } from '../../../src/main/compute/audit';
import { cellHash } from '../../../src/main/compute/consent';

const OK: CellResult = { ok: true, output: { type: 'text', value: 'hi' } };
const ERR: CellResult = { ok: false, error: 'boom' };

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-audit-'));
});
afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('compute execution audit log (#1413)', () => {
  it('records an execution with provenance, hash, outcome, and note path', () => {
    recordExecution({
      project: '/tb', language: 'python', code: 'print(1)', notePath: 'n.md',
      provenance: 'editor', result: OK,
    });
    const [entry] = readAuditLog();
    expect(entry.project).toBe('/tb');
    expect(entry.language).toBe('python');
    expect(entry.provenance).toBe('editor');
    expect(entry.notePath).toBe('n.md');
    expect(entry.ok).toBe(true);
    expect(entry.codeHash).toBe(cellHash('python', 'print(1)'));
    expect(entry.codePreview).toBe('print(1)');
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records a conversation (AI-authored) run and a failure with its error', () => {
    recordExecution({ project: '/tb', language: 'sql', code: 'select 1', provenance: 'conversation', result: ERR });
    const [entry] = readAuditLog();
    expect(entry.provenance).toBe('conversation');
    expect(entry.ok).toBe(false);
    expect(entry.error).toBe('boom');
    expect(entry.notePath).toBeUndefined();
  });

  it('returns entries newest-first', () => {
    recordExecution({ project: '/tb', language: 'python', code: 'a', provenance: 'editor', result: OK });
    recordExecution({ project: '/tb', language: 'python', code: 'b', provenance: 'editor', result: OK });
    recordExecution({ project: '/tb', language: 'python', code: 'c', provenance: 'editor', result: OK });
    expect(readAuditLog().map((e) => e.codePreview)).toEqual(['c', 'b', 'a']);
  });

  it('respects the limit argument', () => {
    for (const c of ['a', 'b', 'c', 'd']) {
      recordExecution({ project: '/tb', language: 'python', code: c, provenance: 'editor', result: OK });
    }
    expect(readAuditLog(2).map((e) => e.codePreview)).toEqual(['d', 'c']);
  });

  it('truncates a long code preview with an ellipsis', () => {
    const long = 'x'.repeat(500);
    recordExecution({ project: '/tb', language: 'python', code: long, provenance: 'editor', result: OK });
    const [entry] = readAuditLog();
    expect(entry.codePreview.length).toBe(281); // 280 + '…'
    expect(entry.codePreview.endsWith('…')).toBe(true);
    // The hash still covers the FULL code, not the preview.
    expect(entry.codeHash).toBe(cellHash('python', long));
  });

  it('reading a missing log returns []', () => {
    expect(readAuditLog()).toEqual([]);
  });

  it('skips a torn/corrupt line rather than throwing', () => {
    recordExecution({ project: '/tb', language: 'python', code: 'ok', provenance: 'editor', result: OK });
    fs.appendFileSync(auditLogPath(), '{ this is not json\n', 'utf-8');
    const entries = readAuditLog();
    expect(entries).toHaveLength(1);
    expect(entries[0].codePreview).toBe('ok');
  });

  it('never throws from recordExecution even if the result error is non-string', () => {
    expect(() =>
      recordExecution({
        project: '/tb', language: 'python', code: 'x', provenance: 'editor',
        result: { ok: false, error: undefined as unknown as string },
      }),
    ).not.toThrow();
    expect(readAuditLog()[0].ok).toBe(false);
  });

  it('keeps the on-disk log bounded once it grows past the cap', () => {
    // Enough small entries to blow well past the 1 MB cap, forcing at least one
    // trim. The invariant is the *on-disk size* stays bounded (the trim runs
    // synchronously after each append), and the newest entry always survives.
    for (let i = 0; i < 8000; i++) {
      recordExecution({ project: '/tb', language: 'python', code: `cell ${i}`, provenance: 'editor', result: OK });
    }
    expect(fs.statSync(auditLogPath()).size).toBeLessThanOrEqual(1_000_000);
    const entries = readAuditLog();
    expect(entries.length).toBeLessThan(8000); // proves a trim happened
    expect(entries[0].codePreview).toBe('cell 7999'); // newest survived
  });
});
