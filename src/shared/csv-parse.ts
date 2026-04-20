/**
 * Small RFC 4180-ish CSV parser used by both the main-process graph
 * indexer and the renderer\u2019s table-view component. Kept pure + tiny so
 * it\u2019s easy to unit-test and cheap to ship in both bundles.
 *
 * Handles: quoted fields, embedded commas, embedded newlines,
 * doubled-quote escapes (`""` \u2192 `"`), trailing newlines, BOM.
 *
 * Does **not** try to detect delimiters (comma only), decode non-UTF-8
 * encodings, infer column datatypes, or reshape jagged rows \u2014 rows get
 * padded/trimmed to the first row\u2019s width.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  /**
   * True when the first row was treated as the header row. False when
   * the first row looked like data and we synthesized `col_1`, `col_2`, \u2026
   */
  hadHeaderRow: boolean;
}

export function parseCsv(text: string): ParsedCsv {
  // Strip BOM if the file starts with one.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records = splitRecords(text);
  if (records.length === 0) {
    return { headers: [], rows: [], hadHeaderRow: false };
  }

  const first = records[0];
  const headerish = looksLikeHeader(first);
  const width = first.length;

  if (headerish) {
    return {
      headers: first.slice(),
      rows: records.slice(1).map((r) => normalizeWidth(r, width)),
      hadHeaderRow: true,
    };
  }

  const headers = Array.from({ length: width }, (_, i) => `col_${i + 1}`);
  return {
    headers,
    rows: records.map((r) => normalizeWidth(r, width)),
    hadHeaderRow: false,
  };
}

function splitRecords(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (c === ',') {
      cur.push(field);
      field = '';
      i++;
      continue;
    }

    if (c === '\r') {
      // Swallow CR. LF on the next iteration closes the record.
      i++;
      continue;
    }

    if (c === '\n') {
      cur.push(field);
      out.push(cur);
      cur = [];
      field = '';
      i++;
      continue;
    }

    field += c;
    i++;
  }

  // Flush the tail unless it\u2019s a purely empty trailing newline.
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    out.push(cur);
  }

  // Drop fully-empty records (common with trailing \\n at EOF).
  return out.filter((r) => !(r.length === 1 && r[0] === ''));
}

function looksLikeHeader(row: string[]): boolean {
  if (row.length === 0) return false;
  for (const cell of row) {
    const s = cell.trim();
    if (!s) return false;                 // empty / whitespace-only cell \u2192 not a header
    if (!isNaN(Number(s))) return false;  // any numeric-looking cell \u2192 not a header
  }
  return true;
}

function normalizeWidth(row: string[], width: number): string[] {
  if (row.length === width) return row;
  if (row.length > width) return row.slice(0, width);
  const out = row.slice();
  while (out.length < width) out.push('');
  return out;
}
