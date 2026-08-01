/**
 * Type-keyed render-card HTML builders (#1071). Pure string→string transforms
 * (mirroring cite-meta.ts) so the preview's post-render pass can inject a card
 * into a wiki-link/quote-link placeholder, and so they unit-test without a DOM.
 *
 * A typed *note* renders a card keyed off its type: cover image (or type icon) +
 * title + a few property chips selected by the type's `card:` template. An
 * *excerpt* renders its highlighted span + source byline + locator. Both build
 * from escaped strings — the injecting pass bypasses DOMPurify (post-render).
 */
import { escapeHtml, escapeAttr } from './text';
import type { NoteTypedProperties } from '../../../shared/objects/type-def';
import { selectCardFields } from '../../../shared/objects/card';
import type { QuoteMeta } from './cite-meta';

/** An http(s) cover value renders as an <img>; anything else falls back to the
 *  type icon (a local/vault path isn't safely loadable inline here). */
export function isImageUrl(v: string | null | undefined): v is string {
  return !!v && /^https?:\/\//i.test(v);
}

/**
 * The card body for a typed note. Caller guarantees `rb.type` is non-null
 * (untyped notes never get a card). Rendered inside the existing `.wiki-link`
 * anchor, so the whole card stays click-to-navigate.
 */
export function buildObjectCardHtml(rb: NoteTypedProperties, opts: { title: string }): string {
  const type = rb.type;
  if (!type) return escapeHtml(opts.title);
  const { fields, cover } = selectCardFields(rb);
  const icon = type.icon ?? '◆';

  const coverHtml = isImageUrl(cover)
    ? `<span class="oc-cover"><img src="${escapeAttr(cover)}" alt="" loading="lazy" /></span>`
    : `<span class="oc-cover oc-cover-icon"${type.color ? ` style="color:${escapeAttr(type.color)}"` : ''}>${escapeHtml(icon)}</span>`;

  const chips = fields
    .filter((f) => f.value !== null && f.value !== '')
    .map(
      (f) =>
        `<span class="oc-field"><span class="oc-flabel">${escapeHtml(f.label)}</span><span class="oc-fval">${escapeHtml(f.value!)}</span></span>`,
    )
    .join('');

  return (
    `${coverHtml}<span class="oc-main">` +
    `<span class="oc-title"><span class="oc-type-icon">${escapeHtml(icon)}</span>${escapeHtml(opts.title)}</span>` +
    (chips ? `<span class="oc-fields">${chips}</span>` : '') +
    `</span>`
  );
}

/** The card body for an excerpt: highlighted span + source byline + locator.
 *  (No annotation — the excerpt TTL carries none; it lives in the derived note.) */
export function buildExcerptCardHtml(meta: QuoteMeta): string {
  const parts: string[] = [];
  if (meta.citedText) parts.push(`<span class="ec-quote">“${escapeHtml(meta.citedText)}”</span>`);

  const byline = [
    meta.sourceTitle,
    meta.sourceCreator && meta.sourceYear
      ? `${meta.sourceCreator} (${meta.sourceYear})`
      : meta.sourceCreator || (meta.sourceYear ? `(${meta.sourceYear})` : ''),
  ]
    .filter(Boolean)
    .join(' — ');

  const loc = meta.pageRange
    ? `pp. ${meta.pageRange}`
    : meta.page
      ? `p. ${meta.page}`
      : meta.locationText ?? '';

  const metaLine = [byline, loc].filter(Boolean).join(' · ');
  if (metaLine) parts.push(`<span class="ec-meta">— ${escapeHtml(metaLine)}</span>`);
  return parts.join('') || `<span class="ec-meta">Excerpt</span>`;
}

/**
 * True when a link is the sole meaningful content of its paragraph — the
 * heuristic for promoting it from an inline chip to a full block card (matches
 * how Capacities renders a link that's alone on a line). Inline links mid-prose
 * return false and are left untouched (zero regression).
 */
export function isBlockLevelLink(a: Element): boolean {
  const p = a.parentElement;
  if (!p || p.tagName !== 'P') return false;
  for (const node of p.childNodes) {
    if (node === a) continue;
    if (node.nodeType === 3 /* text */ && (node.textContent ?? '').trim() !== '') return false;
    if (node.nodeType === 1 /* element */) return false;
  }
  return true;
}
