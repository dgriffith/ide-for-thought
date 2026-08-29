/**
 * A logging seam (#1918). Before this, `console.*` was called directly at
 * ~196 sites across 84 files, roughly half hand-writing a `[tag]` prefix from
 * an open-ended set of ~45 ad-hoc names (some files used none at all) — no
 * level control, and no way to silence a noisy subsystem while debugging
 * another. `logger(tag)` fixes the mechanism, not the volume: every call site
 * still logs exactly what it logged before, just through one seam.
 *
 * Deliberately a leaf — a `console` wrapper, not an observability platform.
 * No transports, no batching, no remote shipping. Importable from main,
 * renderer, or a shared module without pulling in Electron.
 *
 * `LOG_TAGS` is the closed, documented set every call site must pick from —
 * TypeScript rejects a tag not on this list, which is what "consolidated to
 * a documented set" means in practice. Add a tag here deliberately, in the
 * PR that needs it, rather than typing a new bracket string inline.
 */

export const LOG_TAGS = [
  'approval',
  'auto-update',
  'backfill',
  'command-palette',
  'compute',
  'config',
  'conversation',
  'conversation-panel',
  'entrypoint',
  'formatter',
  'graph',
  'help-docs',
  'history',
  'ipc',
  'llm',
  'llm-tools',
  'maintenance',
  'merge',
  'onboarding',
  'preview',
  'privileged-sites',
  'project-context',
  'proposal',
  'python-kernel',
  'query',
  'quit',
  'rename',
  'search',
  'set-properties',
  'settings',
  'skills',
  'sources',
  'substrate',
  'tables',
  'tabs',
  'templates',
  'thoughtbase',
  'vectors',
  'voice',
  'watcher',
  'window-manager',
  'write-guard',
] as const;

export type LogTag = (typeof LOG_TAGS)[number];

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let globalLevel: LogLevel = 'info';
const tagLevels = new Map<LogTag, LogLevel | 'silent'>();

/** Set the default level every tag obeys unless it has its own override. */
export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

/** Override the level for one tag — pass `'silent'` to mute it entirely.
 *  This is the "silence a subsystem" the issue asked for: e.g.
 *  `setTagLevel('watcher', 'silent')` while debugging something else without
 *  losing every other subsystem's output. */
export function setTagLevel(tag: LogTag, level: LogLevel | 'silent'): void {
  tagLevels.set(tag, level);
}

/** Clear a tag's override, falling back to the global level. Exported mainly
 *  for tests to reset state between cases. */
export function clearTagLevel(tag: LogTag): void {
  tagLevels.delete(tag);
}

function shouldLog(tag: LogTag, level: LogLevel): boolean {
  const effective = tagLevels.get(tag) ?? globalLevel;
  if (effective === 'silent') return false;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[effective];
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Fold `[tag]` into the first argument when it's a string, rather than
 * passing it as a separate `console.*` argument — this reproduces the exact
 * single-string console output the ~196 migrated call sites already had
 * (`console.warn('[graph] rebuild failed:', err)`), so migrating a call site
 * changes nothing about what appears in the console or what a test asserting
 * on the logged string sees. Falls back to a separate leading argument only
 * for the rare call that doesn't lead with a string.
 */
function withPrefix(tag: LogTag, args: unknown[]): unknown[] {
  const prefix = `[${tag}]`;
  if (args.length > 0 && typeof args[0] === 'string') {
    return [`${prefix} ${args[0]}`, ...args.slice(1)];
  }
  return [prefix, ...args];
}

/** A logger scoped to one of the {@link LOG_TAGS}. Every message is prefixed
 *  `[tag]`, matching the bracket convention already in use — this just makes
 *  it consistent and level-aware instead of a bare `console.log` call. */
export function logger(tag: LogTag): Logger {
  return {
    debug: (...args) => { if (shouldLog(tag, 'debug')) console.debug(...withPrefix(tag, args)); },
    info: (...args) => { if (shouldLog(tag, 'info')) console.info(...withPrefix(tag, args)); },
    warn: (...args) => { if (shouldLog(tag, 'warn')) console.warn(...withPrefix(tag, args)); },
    error: (...args) => { if (shouldLog(tag, 'error')) console.error(...withPrefix(tag, args)); },
  };
}
