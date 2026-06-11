/**
 * Citation display helpers for the conversation panel (#672, extracted from
 * ConversationsPanel alongside the MessageCitations split).
 */

/** Per-citation "cite into note" progress, keyed in the panel by message +
 *  citation index. Shared by the panel (which owns the state) and the
 *  MessageCitations child (which renders it). */
export type CiteStatus =
  | { phase: 'running' | 'done' }
  | { phase: 'error'; message: string };

/**
 * Compact host label for a citation URL — scheme + leading `www.` stripped.
 * Falls back to the raw string for anything that doesn't parse as a URL.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
