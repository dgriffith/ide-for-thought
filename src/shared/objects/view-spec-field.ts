/**
 * Rewrite one numeric field of an ```object-view fence's JSON spec in place
 * (#2666's `height`, #2709's `width`) — the frame an embed is drawn in, set by
 * a resize handle in the preview.
 *
 * Touches nothing else: a hand-written one-line spec stays on one line, and a
 * pretty-printed one gains one line. If a textual edit can't be verified to
 * mean exactly "same spec, new value", the body is re-serialized in its
 * original layout instead.
 */

import { editNoteText } from '../frontmatter-block';

export type FrameField = 'height' | 'width';

/**
 * Set (or, with `undefined`, remove) `key` in a spec body. Returns null for a
 * body that isn't a JSON object (the caller leaves such a fence alone).
 */
export function setSpecField(body: string, key: FrameField, field: number | undefined): string | null {
  let parsed: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(body);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    parsed = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const want: Record<string, unknown> = { ...parsed };
  if (field === undefined) delete want[key];
  else want[key] = field;

  const edited = textualEdit(body, parsed, key, field);
  if (edited !== null && sameJson(edited, want)) return edited;
  const multiline = body.trim().includes('\n');
  const trailing = body.match(/\s*$/)?.[0] ?? '';
  return (multiline ? JSON.stringify(want, null, 2) : JSON.stringify(want)) + trailing;
}

function textualEdit(body: string, parsed: Record<string, unknown>, key: FrameField, field: number | undefined): string | null {
  const has = Object.prototype.hasOwnProperty.call(parsed, key);
  if (has && field !== undefined) {
    const valueRe = new RegExp(`"${key}"\\s*:\\s*-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?`);
    return body.replace(valueRe, (m) => m.replace(/-?\d[\s\S]*$/, String(field)));
  }
  if (has) {
    // `, "key": N` after another member, or `"key": N,` before one.
    const after = body.replace(new RegExp(`,\\s*"${key}"\\s*:\\s*[^,}\\s]+(?=\\s*\\})`), '');
    if (after !== body) return after;
    return body.replace(new RegExp(`"${key}"\\s*:\\s*[^,}\\s]+\\s*,\\s*`), '');
  }
  if (field === undefined) return body;
  const close = body.lastIndexOf('}');
  if (close < 0) return null;
  const lastContent = body.slice(0, close).trimEnd();
  const comma = lastContent.endsWith('{') ? '' : ',';
  // Whitespace before the closing brace, the brace, and anything after it.
  const tail = body.slice(lastContent.length);
  if (body.trim().includes('\n')) {
    const indent = /\n([ \t]+)"/.exec(body)?.[1] ?? '  ';
    return `${lastContent}${comma}\n${indent}"${key}": ${field}${tail}`;
  }
  const sp = /":\s/.test(body) ? ' ' : '';
  return `${lastContent}${comma}${sp}"${key}":${sp}${field}${tail}`;
}

function sameJson(text: string, want: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(want);
  } catch {
    return false;
  }
}

/**
 * Rewrite `key` in the ```object-view fence that opens on `fenceLine`
 * (1-based, in the full content — a fence's `data-fence-line`). Null when that
 * line isn't an object-view fence any more, or its spec isn't JSON. A CRLF
 * note stays CRLF: the spec is edited as LF and mapped back (#2690).
 */
export function applyObjectViewField(content: string, fenceLine: number, key: FrameField, field: number | undefined): string | null {
  return editNoteText(content, (text) => applyToText(text, fenceLine, key, field));
}

function applyToText(content: string, fenceLine: number, key: FrameField, field: number | undefined): string | null {
  const lines = content.split('\n');
  const open = lines[fenceLine - 1];
  if (open === undefined) return null;
  const m = /^(\s*)(`{3,}|~{3,})\s*object-view\s*$/i.exec(open);
  if (!m) return null;
  const marker = m[2]!;
  let close = fenceLine;
  while (close < lines.length && !new RegExp(`^\\s*${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(lines[close]!)) close++;
  if (close >= lines.length) return null;
  const body = lines.slice(fenceLine, close).join('\n');
  const next = setSpecField(body, key, field);
  if (next === null) return null;
  if (next === body) return content;
  return [...lines.slice(0, fenceLine), ...next.split('\n'), ...lines.slice(close)].join('\n');
}
