/**
 * Compute execution audit log (#1413).
 *
 * Records what code ran, when, from where, and with what outcome — a local
 * forensic trail for the "an LLM wrote subtly broken code into a proposal that
 * got run" threat (#1329). Stored per-machine under
 * `userData/compute-audit.jsonl` (never in the thoughtbase, so a shared/cloned
 * project can't tamper with or omit its own history), one JSON object per line.
 *
 * This is a *record*, not a gate: it never blocks or alters execution, and a
 * write failure is swallowed so auditing can never break a cell run. The
 * consent gate (#1412) and network guard (#1413) are the boundaries; this is
 * the paper trail behind them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { cellHash } from './consent';
import type { CellResult } from '../../shared/compute/types';
import { logger } from '../../shared/logger';

/** Where a cell run originated — an editor ▶ (human-authored/reviewed) vs a
 *  conversation propose_compute Run (LLM-authored). The latter is the
 *  higher-risk path this audit trail most cares about. */
export type ComputeProvenance = 'editor' | 'conversation';

export interface AuditEntry {
  /** ISO-8601 timestamp of when the run finished. */
  at: string;
  /** Thoughtbase root the cell ran against. */
  project: string;
  language: string;
  provenance: ComputeProvenance;
  /** Note the cell lives in, when known (editor runs). */
  notePath?: string;
  /** Content hash of the code — same key the consent store uses, so an audit
   *  entry can be tied back to the consent decision that let it run. */
  codeHash: string;
  /** First slice of the code, for human scanning without opening every hash. */
  codePreview: string;
  /** Whether the run succeeded. */
  ok: boolean;
  /** Truncated error text when `ok` is false. */
  error?: string;
}

const PREVIEW_CHARS = 280;
/** Trim the log once it grows past this; keeps it a bounded tail, not a leak. */
const MAX_BYTES = 1_000_000;
const KEEP_LINES = 1000;

export function auditLogPath(): string {
  return path.join(app.getPath('userData'), 'compute-audit.jsonl');
}

/**
 * Append one execution to the audit log. Never throws — auditing is a
 * side-record that must not affect the run it describes; a write failure is
 * logged to the main console and dropped.
 */
export function recordExecution(input: {
  project: string;
  language: string;
  code: string;
  notePath?: string;
  provenance: ComputeProvenance;
  result: CellResult;
}): void {
  try {
    const { project, language, code, notePath, provenance, result } = input;
    const preview = code.length > PREVIEW_CHARS ? code.slice(0, PREVIEW_CHARS) + '…' : code;
    const entry: AuditEntry = {
      at: new Date().toISOString(),
      project,
      language,
      provenance,
      ...(notePath !== undefined ? { notePath } : {}),
      codeHash: cellHash(language, code),
      codePreview: preview,
      ok: result.ok,
      ...(result.ok ? {} : { error: String(result.error).slice(0, 500) }),
    };
    const p = auditLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(entry) + '\n', 'utf-8');
    trimIfOversized(p);
  } catch (err) {
    logger('compute').warn('failed to record execution:', err);
  }
}

/** Read the audit log newest-first. Returns [] when the log is missing or
 *  unreadable; skips any corrupt line rather than throwing. */
export function readAuditLog(limit?: number): AuditEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(auditLogPath(), 'utf-8');
  } catch {
    return [];
  }
  const entries: AuditEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      // Skip a torn/partial line (e.g. a crash mid-append) rather than fail.
    }
  }
  entries.reverse(); // newest first
  return typeof limit === 'number' ? entries.slice(0, limit) : entries;
}

/** Keep the log bounded: once it exceeds MAX_BYTES, rewrite it with only the
 *  most recent KEEP_LINES entries. Cheap stat-gated check on each append. */
function trimIfOversized(p: string): void {
  let size: number;
  try {
    size = fs.statSync(p).size;
  } catch {
    return;
  }
  if (size <= MAX_BYTES) return;
  const lines = fs.readFileSync(p, 'utf-8').split('\n').filter((l) => l.trim());
  const kept = lines.slice(-KEEP_LINES);
  fs.writeFileSync(p, kept.join('\n') + '\n', 'utf-8');
}
