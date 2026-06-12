/**
 * Pure display helpers for ConversationsPanel (#672) — tab titles, property
 * formatting, source labels. Extracted from the component so the heuristics
 * (auto-title truncation, the doi/arxiv/pmid pill) are testable in isolation.
 */

export interface TabTitleInput {
  title: string | null;
  conversation: { messages: { role: string; content: string }[] };
}

/**
 * Tab label: the explicit title if set, else a preview of the first user
 * message — flattened whitespace, truncated to 60 chars on a word boundary when
 * one falls in the last quarter (so common 60–80 char openers don't slice
 * mid-word) — else "New conversation".
 */
export function tabTitle(tab: TabTitleInput): string {
  if (tab.title) return tab.title;
  const firstUser = tab.conversation.messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New conversation';
  const flat = firstUser.content.replace(/\s+/g, ' ').trim();
  if (!flat) return 'New conversation';
  if (flat.length <= 60) return flat;
  const window = flat.slice(0, 60);
  const lastSpace = window.lastIndexOf(' ');
  return (lastSpace > 45 ? window.slice(0, lastSpace) : window) + '…';
}

/** Render an arbitrary property value for the proposal diff line. */
export function formatPropertyValue(v: unknown): string {
  if (v === null) return '⌫ deleted';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v) ?? ''; } catch { return '[unserializable]'; }
}

/** Human label for a source draft — identifier, else url, else a placeholder. */
export function sourceLabel(s: { identifier?: string; url?: string }): string {
  return s.identifier ?? s.url ?? '(unknown source)';
}

/** Last segment of a project-relative path (the recognisable part of a "Filed:"
 *  line; the full path stays on the link title for disambiguation). */
export function basename(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash >= 0 ? p.slice(slash + 1) : p;
}

/** Cheap heuristic for the "doi / arxiv / pmid / url / id" pill — exact
 *  normalization happens server-side at ingest; this is only the badge label so
 *  a little imprecision is fine. */
export function sourceKindLabel(s: { identifier?: string; url?: string }): string {
  if (s.url) return 'url';
  const id = s.identifier ?? '';
  const stripped = id.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:|arxiv:|pmid:)\s*/i, '');
  if (/^10\./.test(stripped)) return 'doi';
  if (/^\d{4}\.\d{4,5}$|^[a-z-]+(?:\.[a-z-]+)?\/\d{7}$/i.test(stripped)) return 'arxiv';
  if (/^\d+$/.test(stripped)) return 'pmid';
  return 'id';
}
