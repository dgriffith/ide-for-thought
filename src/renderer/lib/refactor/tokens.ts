/**
 * Token renderer for refactor templates.
 *
 * Supports:
 *   {{date}}               ISO date (YYYY-MM-DD) in local time
 *   {{date:FORMAT}}        Custom date format; tokens YYYY, MM, DD, HH, mm, ss
 *   {{title}}              Source note's title / filename
 *   {{new_note_title}}     Extracted note's title
 *   {{new_note_content}}   Extracted note's full body (populated by #124 content templates)
 *   {{source}}             Source note's relative path
 *
 * Unknown tokens render as empty strings so a typo doesn't leak brace
 * literals into filenames.
 */

export interface TokenContext {
  title?: string;
  new_note_title?: string;
  new_note_content?: string;
  source?: string;
  /** Allow callers to pin the date — tests rely on this. */
  now?: Date;
}

const TOKEN_RE = /\{\{([^}]+?)\}\}/g;

export function renderTemplate(template: string, ctx: TokenContext = {}): string {
  const now = ctx.now ?? new Date();
  return template.replace(TOKEN_RE, (_, raw: string) => resolveToken(raw.trim(), ctx, now));
}

function resolveToken(token: string, ctx: TokenContext, now: Date): string {
  if (token === 'date') return formatDate(now, 'YYYY-MM-DD');
  if (token.startsWith('date:')) return formatDate(now, token.slice('date:'.length));
  switch (token) {
    case 'title': return ctx.title ?? '';
    case 'new_note_title': return ctx.new_note_title ?? '';
    case 'new_note_content': return ctx.new_note_content ?? '';
    case 'source': return ctx.source ?? '';
  }
  return '';
}

function formatDate(d: Date, format: string): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const parts: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad2(d.getMonth() + 1),
    DD: pad2(d.getDate()),
    HH: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds()),
  };
  // Replace longest keys first so MM doesn't match inside YYYY-MM-DD.
  const keys = Object.keys(parts).sort((a, b) => b.length - a.length);
  let out = format;
  for (const k of keys) {
    out = out.split(k).join(parts[k]);
  }
  return out;
}
