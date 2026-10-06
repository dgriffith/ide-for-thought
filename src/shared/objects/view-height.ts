/**
 * An object-view embed's height (#2666): the ```object-view spec's optional
 * `height` field, in CSS px. Omitted means the 360px box every embed had
 * before it could be resized, so existing notes are unchanged — and a resize
 * back to 360 removes the field rather than writing the default.
 *
 * Kept out of `view-spec.ts` / `view-note.ts` on purpose: those carry the
 * view's *contents* (scope, filters, sort), and this is the frame it's drawn
 * in. Pure, so the preview, the export renderer and the source rewrite share
 * one clamp.
 */

export const OBJECT_VIEW_DEFAULT_HEIGHT = 360;
export const OBJECT_VIEW_MIN_HEIGHT = 120;
export const OBJECT_VIEW_MAX_HEIGHT = 2000;

/** Clamp a height to what the embed will draw. */
export function clampViewHeight(n: number): number {
  return Math.min(OBJECT_VIEW_MAX_HEIGHT, Math.max(OBJECT_VIEW_MIN_HEIGHT, Math.round(n)));
}

/** A spec's `height` value as the embed draws it: a number, clamped; anything
 *  else (absent, a string, NaN) is the default. */
export function parseViewHeight(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? clampViewHeight(raw) : OBJECT_VIEW_DEFAULT_HEIGHT;
}

/** The `height` an embed's spec carries: nothing at the default. */
export function viewHeightField(height: number | null | undefined): number | undefined {
  if (height === null || height === undefined) return undefined;
  const h = clampViewHeight(height);
  return h === OBJECT_VIEW_DEFAULT_HEIGHT ? undefined : h;
}

const HEIGHT_RE = /"height"\s*:\s*-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;

/**
 * Set (or, with `null` / the default, remove) `height` in an object-view
 * fence's JSON body, touching nothing else: a hand-written one-line spec stays
 * on one line, and a pretty-printed one gains one line. If a textual edit
 * can't be verified to mean exactly "same spec, new height", the body is
 * re-serialized in its original layout instead. Returns null for a body that
 * isn't a JSON object (the caller leaves such a fence alone).
 */
export function setViewHeightInSpec(body: string, height: number | null): string | null {
  let parsed: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(body);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    parsed = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const field = viewHeightField(height);
  const want: Record<string, unknown> = { ...parsed };
  if (field === undefined) delete want.height;
  else want.height = field;

  const edited = textualEdit(body, parsed, field);
  if (edited !== null && sameJson(edited, want)) return edited;
  const multiline = body.trim().includes('\n');
  const trailing = body.match(/\s*$/)?.[0] ?? '';
  return (multiline ? JSON.stringify(want, null, 2) : JSON.stringify(want)) + trailing;
}

function textualEdit(body: string, parsed: Record<string, unknown>, field: number | undefined): string | null {
  const has = Object.prototype.hasOwnProperty.call(parsed, 'height');
  if (has && field !== undefined) return body.replace(HEIGHT_RE, (m) => m.replace(/-?\d[\s\S]*$/, String(field)));
  if (has) {
    // `, "height": N` after another member, or `"height": N,` before one.
    const after = body.replace(/,\s*"height"\s*:\s*[^,}\s]+(?=\s*\})/, '');
    if (after !== body) return after;
    return body.replace(/"height"\s*:\s*[^,}\s]+\s*,\s*/, '');
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
    return `${lastContent}${comma}\n${indent}"height": ${field}${tail}`;
  }
  const sp = /":\s/.test(body) ? ' ' : '';
  return `${lastContent}${comma}${sp}"height":${sp}${field}${tail}`;
}

function sameJson(text: string, want: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(want);
  } catch {
    return false;
  }
}

/**
 * Rewrite the height of the ```object-view fence that opens on `fenceLine`
 * (1-based, in the full content — a fence's `data-fence-line`). Null when that
 * line isn't an object-view fence any more, or its spec isn't JSON.
 */
export function applyObjectViewHeight(content: string, fenceLine: number, height: number | null): string | null {
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
  const next = setViewHeightInSpec(body, height);
  if (next === null) return null;
  if (next === body) return content;
  return [...lines.slice(0, fenceLine), ...next.split('\n'), ...lines.slice(close)].join('\n');
}
