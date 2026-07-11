/**
 * Pure config + HTML builders for the live query-block family that renders in
 * the Preview pane:
 *   - `:::query-backlinks` — the notes that wiki-link to the current note (#1137)
 *   - `:::query-semantic`  — notes semantically similar to free query text (#1128)
 *
 * The block plumbing (parse → execute → inject) lives in Preview.svelte; the
 * data fetch is a direct IPC. These string-only builders keep the selection +
 * markup logic unit-testable, mirroring `cite-meta.ts`. Both are read-only —
 * nothing is written back to the note or graph.
 */
import { escapeHtml, escapeAttr } from './text';
import type { Backlink, RelatedNote } from '../../../shared/types';

function clampLimit(raw: string | undefined, fallback: number, max = 50): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : fallback;
}

function titleHtmlFor(config: Record<string, string>): string {
  return config.title ? `<h4 class="query-title">${escapeHtml(config.title)}</h4>` : '';
}

// ── Backlinks block (#1137) ─────────────────────────────────────────────────

/** Apply the block's `linkType` filter and `limit` to the note's backlinks. */
export function selectBacklinks(rows: Backlink[], config: Record<string, string>): Backlink[] {
  let out = rows;
  if (config.linkType) {
    const wanted = new Set(config.linkType.split(',').map((s) => s.trim()).filter(Boolean));
    if (wanted.size > 0) out = out.filter((b) => wanted.has(b.linkType));
  }
  return out.slice(0, clampLimit(config.limit, 25));
}

export function buildBacklinksHtml(rows: Backlink[], config: Record<string, string>): string {
  const titleHtml = titleHtmlFor(config);
  if (rows.length === 0) return `${titleHtml}<p class="query-empty">No backlinks yet</p>`;
  const items = rows.map((b) => {
    // Show the typed-link badge (cite/quote/supports/…) like the sidebar panel.
    const badge = b.linkLabel
      ? `<span class="query-link-badge" style="background:${escapeAttr(b.linkColor)}">${escapeHtml(b.linkLabel)}</span>`
      : '';
    const label = escapeHtml(b.sourceTitle || b.source);
    return `<li><a class="wiki-link" data-target="${escapeAttr(b.source)}">${label}</a>${badge}</li>`;
  });
  return `${titleHtml}<ul class="query-result-list backlinks-block">${items.join('')}</ul>`;
}

// ── Semantic block (#1128) ──────────────────────────────────────────────────

/** Which corpus kinds the block queries. Defaults to notes (the clickable case);
 *  `kind: source|excerpt|all` overrides. */
export function semanticKinds(config: Record<string, string>): readonly ('note' | 'source' | 'excerpt')[] {
  const raw = (config.kind ?? 'note').toLowerCase();
  if (raw === 'all') return ['note', 'source', 'excerpt'];
  return raw.split(',').map((s) => s.trim()).filter((k): k is 'note' | 'source' | 'excerpt' =>
    k === 'note' || k === 'source' || k === 'excerpt');
}

/** Apply the block's `kind` filter, `threshold` (min cosine similarity), and
 *  `limit`. The kind filter runs client-side so the empty-query path (which
 *  reuses the all-kinds "related to this note" IPC) honors it too. */
export function selectSemanticNotes(notes: RelatedNote[], config: Record<string, string>): RelatedNote[] {
  const kinds = new Set<string>(semanticKinds(config));
  let out = notes.filter((n) => kinds.has(n.kind));
  const threshold = Number.parseFloat(config.threshold ?? '');
  if (Number.isFinite(threshold)) out = out.filter((n) => n.score >= threshold);
  return out.slice(0, clampLimit(config.limit, 8));
}

export function buildSemanticHtml(notes: RelatedNote[], config: Record<string, string>): string {
  const titleHtml = titleHtmlFor(config);
  if (notes.length === 0) return `${titleHtml}<p class="query-empty">No related notes</p>`;
  // `compact: true` → just the link (no section heading, no snippet).
  const compact = config.compact === 'true' || config.compact === 'on';
  const showSnippet = !compact && config.snippet !== 'false' && config.snippet !== 'off';
  const items = notes.map((n) => {
    // Note hits are navigable wiki-links; source/excerpt hits show their title.
    const head = n.kind === 'note'
      ? `<a class="wiki-link" data-target="${escapeAttr(n.ref)}">${escapeHtml(n.title)}</a>`
      : `<span class="semantic-nonnote">${escapeHtml(n.title)}</span>`;
    const section = !compact && n.sectionHeading
      ? `<div class="semantic-section">${escapeHtml(n.sectionHeading)}</div>` : '';
    const snippet = showSnippet && n.snippet
      ? `<div class="semantic-snippet">${escapeHtml(n.snippet)}</div>` : '';
    return `<li>${head}${section}${snippet}</li>`;
  });
  return `${titleHtml}<ul class="query-result-list semantic-block"${compact ? ' data-compact="1"' : ''}>${items.join('')}</ul>`;
}
