/**
 * Pre-execution safety scan for LLM-proposed Python cells (#245).
 *
 * The trust model says the LLM never executes code directly — the user
 * reviews and clicks Run. But the user shouldn't have to be a Python
 * expert to spot dangerous patterns. This scan flags the obvious
 * risk vectors so the card can warn before the first click:
 *
 *   - Network calls (`requests`, `urllib`, `http`, `aiohttp`, `httpx`,
 *     `socket`, `ssl`)
 *   - Subprocess / shell-out (`subprocess`, `os.system`, `os.popen`)
 *   - File-write APIs (`open(…, 'w' | 'a' | 'r+' | 'wb' | …)`,
 *     `pathlib.Path.write_text`, `shutil`)
 *   - Code execution (`exec`, `eval`, `compile`, `__import__`)
 *   - Filesystem traversal beyond `os.path` (any non-path-import of
 *     `os` is flagged conservatively — `os.path` is fine, plain `os`
 *     opens too much surface)
 *
 * The scan is regex-based, not AST-based. A real Python parser on the
 * JS side (tree-sitter-python, etc.) would be more precise, but the
 * cost of false positives here is low — a single extra confirmation
 * click — and the cost of false negatives is bounded by the existing
 * trust gate (the user still has to click Run). The scan rules favour
 * over-flagging when the syntactic surface is genuinely ambiguous.
 *
 * Returns a flat list of flags rather than a single boolean so the
 * renderer can show the user exactly which patterns matched. Pure
 * SPARQL / SQL proposals never need this scan and skip it at the call
 * site — those languages can't reach the filesystem or network from
 * within the executor.
 */

export interface SafetyFlag {
  /** Stable id used by the renderer to dedupe + style. */
  id: string;
  /** Human-readable phrase for the card ("Imports `os`"). */
  message: string;
}

interface Rule {
  id: string;
  /** Regex evaluated against the source code with comments stripped.
   *  Use `m` for multi-line `^` anchors; `g` is not needed since we
   *  only ask whether the pattern matches at all. */
  pattern: RegExp;
  message: string;
}

/** Module names whose mere import is enough to flag.
 *
 *  `os` is included even though `os.path` is benign — there's no
 *  cheap way to distinguish `import os` (which allows `os.system`)
 *  from `from os.path import join` (safe) without parsing. The
 *  user always retains the choice to Run anyway; we just surface
 *  the question. */
const FLAGGED_IMPORT_MODULES = [
  'os',
  'subprocess',
  'shutil',
  'socket',
  'ssl',
  'requests',
  'urllib',
  'http',
  'aiohttp',
  'httpx',
  'pathlib',
];

const RULES: Rule[] = [
  // Imports — `import X` and `from X import …` for each flagged
  // module. Matches `os`, `os.path`, `os.environ` etc. as long as
  // the segment starts with the module name.
  ...FLAGGED_IMPORT_MODULES.map((mod): Rule => ({
    id: `imports-${mod}`,
    // (?:^|\n) anchors to a logical line start (with \s* to allow
    // indentation inside try/conditionals). The (?!\w) tail rejects
    // continuations of the module name (so `import socket` matches
    // but `import socketserver_safe` would not — though we'd want
    // socketserver flagged anyway). Allows trailing punctuation like
    // `;`, `,`, `.`, end-of-line via negative-lookahead instead of
    // an explicit allowlist.
    pattern: new RegExp(`(?:^|\\n)\\s*(?:from\\s+${mod}(?!\\w)|import\\s+(?:[\\w.]+,\\s*)*${mod}(?!\\w))`, 'm'),
    message: `Imports \`${mod}\``,
  })),
  // Direct dangerous-builtin calls. The pattern is loose on purpose —
  // user code with a custom `eval` function named `eval` would also
  // flag, which is the right behavior.
  {
    id: 'calls-eval',
    pattern: /\beval\s*\(/,
    message: 'Calls `eval()`',
  },
  {
    id: 'calls-exec',
    pattern: /\bexec\s*\(/,
    message: 'Calls `exec()`',
  },
  {
    id: 'calls-compile',
    pattern: /\bcompile\s*\(/,
    message: 'Calls `compile()`',
  },
  {
    id: 'calls-dunder-import',
    pattern: /\b__import__\s*\(/,
    message: 'Calls `__import__()`',
  },
  // File-write modes for the builtin `open`. The mode string is the
  // second positional argument: `open(path, "w")`, `open(p, "wb")`,
  // `open(p, "r+")`, etc. Risky modes contain `w`, `a`, `x`, or `+`
  // anywhere; read-only modes (`r`, `rb`, `rt`) don't. The pattern
  // requires the mode to live inside the second-arg quoted string —
  // anchoring on `, ['"]` so a literal `w` in the filename ("x.csv")
  // doesn't trip the flag.
  {
    id: 'opens-file-for-write',
    pattern: /\bopen\s*\([^,)]+,\s*['"`][rwxabt]*[wax+][rwxabt+]*['"`]/,
    message: 'Opens a file for writing',
  },
  // pathlib write helpers.
  {
    id: 'pathlib-write',
    pattern: /\.write_(?:text|bytes)\s*\(/,
    message: 'Calls `.write_text()` / `.write_bytes()`',
  },
  // Subprocess module is already caught by imports-subprocess, but
  // direct `os.system` and `os.popen` deserve their own flag for
  // clarity.
  {
    id: 'os-system',
    pattern: /\bos\.system\s*\(/,
    message: 'Calls `os.system()`',
  },
  {
    id: 'os-popen',
    pattern: /\bos\.popen\s*\(/,
    message: 'Calls `os.popen()`',
  },
];

/**
 * Run every safety rule against the proposed code and return the
 * flags that hit. Empty list means "no surface-visible danger" — the
 * user can Run with a single click. Non-empty means the renderer
 * should show the flags and require an extra confirm.
 *
 * Strips `# …` line comments before matching so a literal pattern
 * in a comment ("don't call os.system") doesn't trip the scan.
 * Doesn't strip string literals — flagging code that builds the
 * forbidden call as a string is intentional (string-based shell-out
 * via `exec(some_string)` is a real attack vector).
 */
export function scanPythonSafety(code: string): SafetyFlag[] {
  const stripped = stripPythonComments(code);
  const flags: SafetyFlag[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    if (seen.has(rule.id)) continue;
    if (rule.pattern.test(stripped)) {
      flags.push({ id: rule.id, message: rule.message });
      seen.add(rule.id);
    }
  }
  return flags;
}

/**
 * Remove `# …` line comments. Doesn't handle hash characters inside
 * string literals — those are rare enough in proposal-shaped code
 * that we accept the false positive. Triple-quoted docstrings are
 * left intact (they aren't comments by Python's definition).
 */
function stripPythonComments(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('#');
      if (idx < 0) return line;
      // Crude: if there's an odd number of quotes before the #, we're
      // inside a string literal. Bail out and keep the line as-is.
      const prefix = line.slice(0, idx);
      const quotes = (prefix.match(/['"]/g) ?? []).length;
      if (quotes % 2 === 1) return line;
      return prefix.trimEnd();
    })
    .join('\n');
}
