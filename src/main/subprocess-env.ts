/**
 * Environments for child processes that run code Minerva didn't write
 * (#2560): the Python compute kernel and MCP stdio servers.
 *
 * Both used to inherit `...process.env` — everything the login shell
 * exported, which on a developer's machine (and always when launched from a
 * terminal or via the `minerva` shim) includes `ANTHROPIC_API_KEY`,
 * `OPENAI_API_KEY`, `GH_TOKEN`, AWS keys. A notebook cell, a planted
 * `sitecustomize.py` (#2555) or a third-party MCP server could read them, and
 * with network allowed, send them anywhere. So each child gets an ALLOWLIST
 * of what it needs to run, plus the values Minerva itself sets.
 *
 * The base is the MCP SDK's `getDefaultEnvironment()` set (POSIX and
 * Windows), plus locale (`LANG`, `LC_*`), `TMPDIR` and `TZ`. Values that start
 * with `()` are skipped, as the SDK does: they're exported shell functions
 * (Shellshock-shaped), not configuration.
 *
 * Anything else a user's setup genuinely needs is added deliberately: an MCP
 * server's own `descriptor.env`, or — for the kernel — `KERNEL_ENV_EXTRA`
 * below, which covers interpreter discovery and CA bundles.
 *
 * Pure: takes the source env as an argument so tests don't touch the real one.
 */

/** Exact variable names every allowlisted child receives (when set). */
const BASE_KEYS = [
  // POSIX (MCP SDK's default set)
  'HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER',
  // Windows (MCP SDK's default set)
  'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PROCESSOR_ARCHITECTURE',
  'PROGRAMFILES', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'USERNAME', 'USERPROFILE',
  // Locale, temp dir and time zone — affect behaviour, carry no secrets.
  'LANG', 'TMPDIR', 'TMP', 'TZ',
] as const;

/** Prefixes every allowlisted child receives. */
const BASE_PREFIXES = ['LC_'] as const;

/**
 * Extra names the Python kernel receives: how the chosen interpreter finds
 * its environment (venv, pyenv, conda) and where TLS trust roots live. None
 * holds a credential.
 */
export const KERNEL_ENV_EXTRA = {
  keys: ['VIRTUAL_ENV', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE'],
  prefixes: ['PYENV_', 'CONDA_'],
} as const;

interface Allowlist {
  keys?: readonly string[];
  prefixes?: readonly string[];
}

/**
 * The allowlisted subset of `source`: the base set plus `extra`. Keys are
 * matched case-sensitively, except on Windows where env names are
 * case-insensitive (`Path`).
 */
export function allowlistedEnv(
  source: NodeJS.ProcessEnv,
  extra: Allowlist = {},
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const fold = platform === 'win32' ? (s: string) => s.toUpperCase() : (s: string) => s;
  const keys = new Set([...BASE_KEYS, ...(extra.keys ?? [])].map(fold));
  const prefixes = [...BASE_PREFIXES, ...(extra.prefixes ?? [])].map(fold);
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || value.startsWith('()')) continue;
    const n = fold(name);
    if (keys.has(n) || prefixes.some((p) => n.startsWith(p))) out[name] = value;
  }
  return out;
}
