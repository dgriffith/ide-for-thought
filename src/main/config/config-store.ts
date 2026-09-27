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
import { logger } from '../../shared/logger';

export type ConfigDecoder<T> = (raw: unknown) => T;

type Phase = 'read' | 'parse' | 'validate';

/** Consistent, surfaced config failure. Loud (not the old silent swallow) but
 *  non-fatal — a bad config must not crash startup. Exported so a future PR can
 *  route it to a user-facing toast; today it logs with a recognizable prefix. */
export function reportConfigError(file: string, phase: Phase, err: unknown, consequence = 'using defaults'): void {
  const detail = err instanceof Error ? err.message : String(err);
  logger('config').error(`failed to ${phase} "${file}": ${detail} — ${consequence}`);
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** Defensive copy so a caller mutating the result can't corrupt the shared
 *  DEFAULT_* singletons (the old `return { ...DEFAULT }` idiom, generalized). */
function clone<T>(v: T): T {
  return v !== null && typeof v === 'object' ? structuredClone(v) : v;
}

function decodeText<T>(absPath: string, text: string, decode: ConfigDecoder<T>, defaults: T): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    reportConfigError(absPath, 'parse', err);
    return clone(defaults);
  }
  try {
    return decode(raw);
  } catch (err) {
    reportConfigError(absPath, 'validate', err);
    return clone(defaults);
  }
}

/** Load + validate a JSON config file (async). `getPath` returns the absolute
 *  path; see module header for why it's a thunk. */
export async function loadConfigFile<T>(getPath: () => string, decode: ConfigDecoder<T>, defaults: T): Promise<T> {
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
  return decodeText(absPath, text, decode, defaults);
}

/** Synchronous variant, for the hot read paths that can't await (e.g.
 *  `readProjectConfig`, consulted during indexing). Same semantics. */
export function loadConfigFileSync<T>(getPath: () => string, decode: ConfigDecoder<T>, defaults: T): T {
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
  return decodeText(absPath, text, decode, defaults);
}

// ── Strict loading, for read-modify-write (#2416) ────────────────────────────

/**
 * Thrown by the strict loaders when a config file exists but cannot be read,
 * parsed, or decoded. The message names the file and says nothing was written,
 * because it reaches the user as an IPC rejection; the original error rides
 * along as `cause`.
 */
export class UnreadableConfigError extends Error {
  constructor(
    readonly file: string,
    readonly phase: Phase,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`"${file}" could not be ${PHASE_PAST[phase]} (${detail}); it was left untouched. Fix or remove it, then retry.`, { cause });
    this.name = 'UnreadableConfigError';
  }
}

const PHASE_PAST: Record<Phase, string> = { read: 'read', parse: 'parsed', validate: 'validated' };
const REFUSING = 'refusing to write over it';

function strictDecode<T>(absPath: string, text: string, decode: ConfigDecoder<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    reportConfigError(absPath, 'parse', err, REFUSING);
    throw new UnreadableConfigError(absPath, 'parse', err);
  }
  try {
    return decode(raw);
  } catch (err) {
    reportConfigError(absPath, 'validate', err, REFUSING);
    throw new UnreadableConfigError(absPath, 'validate', err);
  }
}

/**
 * STRICT load, for the read half of a read-modify-write (#2416). Same decoder
 * as `loadConfigFile`, opposite failure contract:
 *
 *   - missing file (ENOENT) → `empty` (nothing saved yet is not an error);
 *   - unreadable / malformed / structurally wrong → reported, then THROWS
 *     `UnreadableConfigError`.
 *
 * The lenient loader's "corrupt reads as defaults" is right for DISPLAY and
 * wrong for a WRITE: a write built on those defaults replaces every entry the
 * file held with just the one being changed (#1891, #2356). A store therefore
 * reads leniently to show and strictly to mutate, and the decoder must throw
 * on a wrong top-level shape (an array where an object belongs), or that
 * clobber gets back in through `decode` instead of `JSON.parse`.
 *
 * Takes a plain path, not a thunk: a writer that cannot resolve its path
 * cannot write either, so there is no quiet fallback to preserve.
 */
export async function loadConfigFileStrict<T>(absPath: string, decode: ConfigDecoder<T>, empty: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(absPath, 'utf-8');
  } catch (err) {
    if (isENOENT(err)) return clone(empty);
    reportConfigError(absPath, 'read', err, REFUSING);
    throw new UnreadableConfigError(absPath, 'read', err);
  }
  return strictDecode(absPath, text, decode);
}

/** Synchronous twin of `loadConfigFileStrict`, for the synchronous stores. */
export function loadConfigFileStrictSync<T>(absPath: string, decode: ConfigDecoder<T>, empty: T): T {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf-8');
  } catch (err) {
    if (isENOENT(err)) return clone(empty);
    reportConfigError(absPath, 'read', err, REFUSING);
    throw new UnreadableConfigError(absPath, 'read', err);
  }
  return strictDecode(absPath, text, decode);
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

/** `raw` itself as a plain object, or THROW. For a decoder whose file must be an
 *  object at the top level: `asRecord` would read `[]` or `"x"` as `{}`, which
 *  the strict loader would then hand to a write as "no entries" (#2416). */
export function requireRecord(raw: unknown, what = 'config file'): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${what} is not a JSON object`);
  }
  return raw as Record<string, unknown>;
}

/** `raw` itself as an array, or THROW — the array-rooted twin of `requireRecord`. */
export function requireArray(raw: unknown, what = 'config file'): unknown[] {
  if (!Array.isArray(raw)) throw new Error(`${what} is not a JSON array`);
  return raw;
}

export function asStringArray(v: unknown, fallback: string[] = []): string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v) : fallback;
}
