/**
 * CSV schema declarations (#237).
 *
 * Pins column types and CSV-shape hints for files where DuckDB's
 * `read_csv_auto` inference falls short (dates, categorical strings,
 * mixed-type columns, unusual encodings).
 *
 * Two sources, checked in order:
 *
 *   1. A `csv:` block in the companion markdown note's frontmatter
 *      (`<stem>.md` next to `<stem>.csv`). Consistent with how the
 *      existing `table_name:` override works.
 *   2. A `<stem>.csv.schema.yaml` sidecar next to the CSV. Useful when
 *      no companion note exists.
 *
 * Both look like:
 *
 *   ```yaml
 *   columns:
 *     submitted_at: DATE
 *     category: VARCHAR
 *     score: DOUBLE
 *   delimiter: "\t"
 *   header: false
 *   ```
 *
 * Returns `null` when no schema is present OR the candidate parsed but
 * its shape is invalid (no `columns` map, or non-string values). The
 * registration path falls back to `read_csv_auto` whenever this
 * returns null — schema-less CSVs are still loaded by auto-inference.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export interface CsvSchema {
  /** Column name → DuckDB type literal (e.g. "VARCHAR", "DATE",
   *  "DECIMAL(10,2)"). Values are passed through to DuckDB without
   *  semantic validation — a typo surfaces as a registration warning. */
  columns: Record<string, string>;
  /** Single-character field delimiter. Omit for the DuckDB default
   *  (auto-detect, usually `,`). */
  delimiter?: string;
  /** False if the first row of data isn't a header. Omit to let
   *  DuckDB auto-detect. */
  header?: boolean;
}

/**
 * Resolve a CSV's schema declaration, if any. Companion-note
 * frontmatter wins; sidecar YAML is the fallback. Returns null when
 * neither source is present or readable as a valid schema.
 */
export async function loadCsvSchema(
  rootPath: string,
  csvRelPath: string,
): Promise<CsvSchema | null> {
  const fromCompanion = await readCompanionSchema(rootPath, csvRelPath);
  if (fromCompanion) return fromCompanion;
  return readSidecarSchema(rootPath, csvRelPath);
}

/** Sidecar path: `path/to/foo.csv` → `path/to/foo.csv.schema.yaml`. */
export function sidecarSchemaPath(csvRelPath: string): string {
  return `${csvRelPath}.schema.yaml`;
}

/** Companion note path: `path/to/foo.csv` → `path/to/foo.md`. */
export function companionMdPath(csvRelPath: string): string {
  const dir = path.dirname(csvRelPath);
  const stem = path.basename(csvRelPath, path.extname(csvRelPath));
  return dir === '.' ? `${stem}.md` : `${dir}/${stem}.md`;
}

async function readCompanionSchema(
  rootPath: string,
  csvRelPath: string,
): Promise<CsvSchema | null> {
  const companionAbs = path.join(rootPath, companionMdPath(csvRelPath));
  let content: string;
  try {
    content = await fs.readFile(companionAbs, 'utf-8');
  } catch {
    return null;
  }
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  let fm: unknown;
  try {
    fm = YAML.parse(m[1]);
  } catch {
    return null;
  }
  if (!fm || typeof fm !== 'object') return null;
  const rec = fm as Record<string, unknown>;
  const raw = rec.csv;
  if (raw == null) return null;
  return validateSchema(raw, `companion frontmatter for ${csvRelPath}`);
}

async function readSidecarSchema(
  rootPath: string,
  csvRelPath: string,
): Promise<CsvSchema | null> {
  const sidecarAbs = path.join(rootPath, sidecarSchemaPath(csvRelPath));
  let content: string;
  try {
    content = await fs.readFile(sidecarAbs, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (err) {
    console.warn(
      `[tables] Sidecar schema ${sidecarSchemaPath(csvRelPath)} is not valid YAML: ` +
      (err instanceof Error ? err.message : String(err)),
    );
    return null;
  }
  return validateSchema(parsed, sidecarSchemaPath(csvRelPath));
}

/**
 * Shape check. Accepts:
 *   - `columns` is a non-empty mapping of string keys to string values.
 *   - `delimiter` is optional; if present, a non-empty string.
 *   - `header` is optional; if present, a boolean.
 *
 * Rejects (with a console warning) anything else so a typo in the
 * schema file doesn't silently land an empty / broken registration.
 */
function validateSchema(raw: unknown, sourceLabel: string): CsvSchema | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(`[tables] ${sourceLabel}: schema block must be a mapping.`);
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const cols = rec.columns;
  if (!cols || typeof cols !== 'object' || Array.isArray(cols)) {
    console.warn(`[tables] ${sourceLabel}: \`columns\` must be a mapping of name → type.`);
    return null;
  }
  const columns: Record<string, string> = {};
  for (const [name, type] of Object.entries(cols as Record<string, unknown>)) {
    if (typeof name !== 'string' || !name.trim()) continue;
    if (typeof type !== 'string' || !type.trim()) {
      console.warn(`[tables] ${sourceLabel}: column "${name}" has a non-string type; skipped.`);
      continue;
    }
    columns[name] = type.trim();
  }
  if (Object.keys(columns).length === 0) {
    console.warn(`[tables] ${sourceLabel}: \`columns\` is empty after validation.`);
    return null;
  }
  const out: CsvSchema = { columns };
  if (typeof rec.delimiter === 'string' && rec.delimiter.length > 0) {
    out.delimiter = rec.delimiter;
  }
  if (typeof rec.header === 'boolean') {
    out.header = rec.header;
  }
  return out;
}

/**
 * Build the DuckDB SQL fragment to read a CSV with an explicit
 * schema. Quoting follows DuckDB's SQL rules: single-quoted string
 * literals with `'` doubled to escape. Column names go through the
 * same single-quote treatment since they're STRUCT keys here.
 *
 * Type strings are passed through verbatim — DuckDB validates them at
 * parse time and surfaces a useful error if the user wrote a bogus
 * type. We intentionally don't allowlist DuckDB types here; the cost
 * of getting that list wrong (DuckDB adds new types) is higher than
 * the cost of "DuckDB couldn't parse `INT`" surfacing as a warning.
 */
export function buildReadCsvSql(absPath: string, schema: CsvSchema): string {
  const pathLit = sqlString(absPath);
  // Column-name keys are single-quoted strings rather than bare
  // identifiers so names containing hyphens, spaces, or other
  // identifier-unsafe characters round-trip through DuckDB's parser
  // unchanged.
  const cols = Object.entries(schema.columns)
    .map(([name, type]) => `'${sqlString(name)}': '${sqlString(type)}'`)
    .join(', ');
  const parts = [`'${pathLit}'`, `columns = {${cols}}`];
  if (schema.delimiter !== undefined) {
    parts.push(`delim = '${sqlString(schema.delimiter)}'`);
  }
  if (schema.header !== undefined) {
    parts.push(`header = ${schema.header}`);
  }
  return `read_csv(${parts.join(', ')})`;
}

function sqlString(value: string): string {
  return value.replace(/'/g, "''");
}
