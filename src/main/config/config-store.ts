/**
 * Shared load + validation for the app's JSON config files (#1640).
 *
 * Every config loader used to hand-roll the same shape: `try { readFile;
 * JSON.parse; coerce each field } catch { return defaults }`. The bare `catch`
 * silently turned a CORRUPT config into defaults — the user's settings vanish
 * with no signal — and each file validated its fields a slightly different way.
 *
 * This centralizes the mechanism:
 *   - A missing file (ENOENT) → defaults, silently (expected: "not saved yet").
 *   - A read / parse / validate FAILURE → reported loudly + consistently via
 *     `reportConfigError`, then defaults (the app still boots; the corruption is
 *     no longer swallowed).
 *   - Per-field coercion goes through the small shared `as*` decoders below, so
 *     "schema" is one declarative `decode(raw)` per config instead of ad-hoc
 *     `typeof` ladders scattered across ~10 files.
 *
 * The `decode` callback owns the config's shape (fill defaults per field, or
 * throw to reject a structurally-invalid payload — a throw is caught and
 * reported like a parse error). This module imports only `node:fs`, so it's
 * unit-testable without electron.
 *
 * The path is supplied as a THUNK (`() => absPath`), evaluated inside the
 * protected region: many config paths are built from `app.getPath('userData')`,
 * which throws when electron isn't present (unit tests). A path we can't even
 * resolve is treated like a missing file — quiet fallback to defaults — matching
 * the pre-#1640 `try { … app.getPath … } catch { defaults }` behavior.
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export type ConfigDecoder<T> = (raw: unknown) => T;

type Phase = 'read' | 'parse' | 'validate';

/** The reserved key that stamps a persisted config's schema version (#1641).
 *  Absent ⇒ version 0 (a pre-versioning / legacy file). */
export const CONFIG_VERSION_KEY = 'configVersion';

export interface MigrationOptions {
  /** The schema version this build writes and expects after decode. */
  version: number;
  /**
   * Bring a raw parsed object from its stored version up to `version`, keyed off
   * the version field — the explicit replacement for ad-hoc shape-sniffing
   * (#1641). Receives the raw object + its detected stored version (0 when the
   * file predates versioning) and returns the migrated raw (still pre-decode).
   * Only invoked when the stored version is behind `version`. Omit when no
   * migration is needed yet (a fresh config is born at `version`).
   */
  migrate?: (raw: Record<string, unknown>, fromVersion: number) => Record<string, unknown>;
}

/** Read the stamped schema version off a raw parsed config (0 = legacy). */
export function detectConfigVersion(raw: unknown): number {
  return asFiniteNumber(asRecord(raw)[CONFIG_VERSION_KEY], 0);
}

/** Stamp the current schema version onto a config for persistence (#1641). Call
 *  in the save path so every write records the version the migration keys off. */
export function stampConfigVersion<T extends object>(config: T, version: number): T & { configVersion: number } {
  return { ...config, [CONFIG_VERSION_KEY]: version };
}

/** Consistent, surfaced config failure. Loud (not the old silent swallow) but
 *  non-fatal — a bad config must not crash startup. Exported so a future PR can
 *  route it to a user-facing toast; today it logs with a recognizable prefix. */
export function reportConfigError(file: string, phase: Phase, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[config] failed to ${phase} "${file}": ${detail} — using defaults`);
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** Defensive copy so a caller mutating the result can't corrupt the shared
 *  DEFAULT_* singletons (the old `return { ...DEFAULT }` idiom, generalized). */
function clone<T>(v: T): T {
  return v !== null && typeof v === 'object' ? structuredClone(v) : v;
}

function decodeText<T>(absPath: string, text: string, decode: ConfigDecoder<T>, defaults: T, opts?: MigrationOptions): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    reportConfigError(absPath, 'parse', err);
    return clone(defaults);
  }
  try {
    if (opts?.migrate) {
      const from = detectConfigVersion(raw);
      if (from < opts.version) raw = opts.migrate(asRecord(raw), from);
    }
    return decode(raw);
  } catch (err) {
    reportConfigError(absPath, 'validate', err);
    return clone(defaults);
  }
}

/** Load + validate a JSON config file (async). `getPath` returns the absolute
 *  path; see module header for why it's a thunk. */
export async function loadConfigFile<T>(getPath: () => string, decode: ConfigDecoder<T>, defaults: T, opts?: MigrationOptions): Promise<T> {
  const absPath = resolvePath(getPath);
  if (absPath === null) return clone(defaults);
  let text: string;
  try {
    text = await readFile(absPath, 'utf-8');
  } catch (err) {
    if (isENOENT(err)) return clone(defaults);
    reportConfigError(absPath, 'read', err);
    return clone(defaults);
  }
  return decodeText(absPath, text, decode, defaults, opts);
}

/** Synchronous variant, for the hot read paths that can't await (e.g.
 *  `readProjectConfig`, consulted during indexing). Same semantics. */
export function loadConfigFileSync<T>(getPath: () => string, decode: ConfigDecoder<T>, defaults: T, opts?: MigrationOptions): T {
  const absPath = resolvePath(getPath);
  if (absPath === null) return clone(defaults);
  let text: string;
  try {
    text = readFileSync(absPath, 'utf-8');
  } catch (err) {
    if (isENOENT(err)) return clone(defaults);
    reportConfigError(absPath, 'read', err);
    return clone(defaults);
  }
  return decodeText(absPath, text, decode, defaults, opts);
}

/** Resolve the path thunk; `null` = couldn't even locate the config (e.g.
 *  `app.getPath` threw with no electron) → caller falls back to defaults. */
function resolvePath(getPath: () => string): string | null {
  try {
    return getPath();
  } catch {
    return null;
  }
}

// ── Field decoders (the shared "schema" vocabulary) ──────────────────────────
// Each takes the raw value + a fallback and returns a well-typed value, so a
// config's `decode` reads as a declaration of its shape.

export function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

export function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function asFiniteNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/** A plain object (not null, not an array), or `{}` — the safe base for
 *  reaching into nested config sections. */
export function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function asStringArray(v: unknown, fallback: string[] = []): string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v) : fallback;
}
