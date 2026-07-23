/**
 * Static red-flag scan across every executable compute language (#1413).
 *
 * A thin dispatcher over the per-language scanners: it answers "does this cell
 * contain syntactically-visible risky patterns?" so both the editor gutter and
 * the propose_compute card can flag a cell *before* it runs. This is an
 * attention-raiser, explicitly NOT a security boundary — the consent gate
 * (#1412), network guard (#1413), and OS sandbox (#1329) are the boundaries.
 * Over-flagging is fine (an extra glance); the scan favours it.
 *
 *   - Python — network / subprocess / file-write / dynamic-exec (delegates to
 *     `scanPythonSafety`, the original #245 scan).
 *   - SQL (DuckDB) — `COPY … TO` (file/URL write = exfil), extension
 *     `INSTALL` / `LOAD`, and `ATTACH` (reach another database/file).
 *   - SPARQL — read-only against the graph; nothing to flag.
 */

import { scanPythonSafety, type SafetyFlag } from '../python-safety';

export type { SafetyFlag } from '../python-safety';

interface SqlRule {
  id: string;
  pattern: RegExp;
  message: string;
}

const SQL_RULES: SqlRule[] = [
  {
    // `COPY (…) TO 'file'` / `COPY tbl TO 'https://…'` — DuckDB's write/exfil
    // primitive. The `TO` must be followed by a quoted target so a `COPY FROM`
    // (read) doesn't trip it.
    id: 'sql-copy-to',
    pattern: /\bCOPY\b[\s\S]{0,400}?\bTO\b\s*['"]/i,
    message: 'Writes to a file/URL with `COPY … TO`',
  },
  {
    id: 'sql-install-extension',
    pattern: /\bINSTALL\s+\w/i,
    message: 'Installs a DuckDB extension',
  },
  {
    id: 'sql-load-extension',
    pattern: /\bLOAD\s+\w/i,
    message: 'Loads a DuckDB extension',
  },
  {
    id: 'sql-attach',
    pattern: /\bATTACH\b/i,
    message: 'Attaches an external database',
  },
];

/**
 * Scan a DuckDB SQL cell for write / extension / attach patterns. Strips
 * `-- …` line comments first so a pattern mentioned in a comment doesn't trip
 * the flag (mirrors the Python scan's comment handling). String literals are
 * left intact — a `COPY … TO` built as a string is still worth flagging.
 */
export function scanSqlSafety(code: string): SafetyFlag[] {
  const stripped = stripSqlLineComments(code);
  const flags: SafetyFlag[] = [];
  for (const rule of SQL_RULES) {
    if (rule.pattern.test(stripped)) flags.push({ id: rule.id, message: rule.message });
  }
  return flags;
}

/**
 * Red-flag scan for any executable fence language. Returns the matched flags
 * (empty === nothing surface-visible). Python aliases (`py` / `python3`) map to
 * the Python scan; SPARQL and anything non-executable return `[]`.
 */
export function scanComputeSafety(language: string, code: string): SafetyFlag[] {
  const lang = language.toLowerCase();
  if (lang === 'python' || lang === 'py' || lang === 'python3') return scanPythonSafety(code);
  if (lang === 'sql') return scanSqlSafety(code);
  return [];
}

/** Drop `-- …` line comments. Doesn't attempt to respect `--` inside string
 *  literals — rare in cell-shaped SQL, and over-stripping only loses a flag on
 *  a contrived line, never adds a false positive. */
function stripSqlLineComments(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx < 0 ? line : line.slice(0, idx);
    })
    .join('\n');
}
