/**
 * How Minerva can render a file, keyed by extension (#1130).
 *
 * The project tree lists every file now, so clicking one must route to the
 * right viewer — or say "no preview" instead of slurping a binary as text.
 * This is the single source of truth both the editor host and the file tree
 * consult, so the icon a row shows and the view it opens can't drift.
 *
 *  - `markdown`   — the full note editor (markdown extensions on). The files
 *                   that already opened there — `.md`, plus `.ttl`/`.csv`/`.py`
 *                   — keep doing so, unchanged.
 *  - `plaintext`  — the editor in plain-text/code mode (markdown behaviors off):
 *                   editable + saveable, but no section numbers, wiki-link
 *                   autocomplete, format-on-paste, footnote/highlight decorations.
 *  - `unsupported`— no in-app renderer (binaries, unknown types). The host shows
 *                   a calm "no preview" panel with open-externally affordances,
 *                   and never reads the file as text.
 */
export type FileCapability = 'markdown' | 'plaintext' | 'unsupported';

/** Files that open in the full markdown note editor (unchanged from before). */
const MARKDOWN_EXTS: ReadonlySet<string> = new Set(['.md', '.ttl', '.csv', '.py']);

/**
 * Plainly-textual files that open in plain-text mode. An allowlist (rather than
 * "anything not known-binary") so an unknown extension defaults to `unsupported`
 * and we never read a binary blob into a string.
 */
const PLAINTEXT_EXTS: ReadonlySet<string> = new Set([
  '.txt', '.text', '.log', '.json', '.jsonl', '.ndjson', '.geojson',
  '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.properties', '.env',
  '.csv.schema.yaml', // paired CSV schema sidecar, edited as text
  '.css', '.scss', '.sass', '.less',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.svelte', '.vue',
  '.html', '.htm', '.svg', '.rss', '.atom',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat',
  '.sql', '.graphql', '.gql',
  '.rs', '.go', '.java', '.kt', '.swift', '.dart', '.scala', '.groovy', '.gradle',
  '.c', '.h', '.hpp', '.hh', '.cpp', '.cc', '.cxx', '.m', '.mm',
  '.rb', '.php', '.pl', '.pm', '.lua', '.r', '.jl', '.hs', '.ml', '.ex', '.exs', '.clj', '.erl',
  '.tex', '.bib', '.rst', '.org', '.adoc', '.asciidoc',
  '.diff', '.patch', '.gitignore', '.gitattributes', '.editorconfig', '.dockerignore',
  '.makefile', '.mk', '.cmake', '.tf', '.tfvars', '.proto',
]);

/** Lowercased extension including the leading dot, or '' when there is none. */
export function extensionOf(pathOrName: string): string {
  const base = pathOrName.split('/').pop() ?? pathOrName;
  const dot = base.lastIndexOf('.');
  // A leading-dot name with no other dot (".gitignore") is treated as an
  // extension so those config files still read as plain text.
  if (dot <= 0) return dot === 0 ? base.toLowerCase() : '';
  return base.slice(dot).toLowerCase();
}

export function fileCapability(pathOrName: string): FileCapability {
  const lower = (pathOrName.split('/').pop() ?? pathOrName).toLowerCase();
  // Double-extension sidecar (`<stem>.csv.schema.yaml`) is a plain-text edit.
  if (lower.endsWith('.csv.schema.yaml')) return 'plaintext';
  const ext = extensionOf(pathOrName);
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (PLAINTEXT_EXTS.has(ext)) return 'plaintext';
  return 'unsupported';
}

/** True when a file opens in an editable text buffer (markdown or plain text) —
 *  i.e. it is safe to `readFile` it as a string. `unsupported` files must not
 *  be read as text (they may be large binaries). */
export function isTextEditable(pathOrName: string): boolean {
  return fileCapability(pathOrName) !== 'unsupported';
}
