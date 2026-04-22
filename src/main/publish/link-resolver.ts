/**
 * Wiki-link resolution for exports (#246).
 *
 * Every exporter handles the same link grammar — `[[target]]`,
 * `[[target|display]]`, `[[target#anchor]]`, typed links like
 * `[[references::target]]` — so the resolution logic lives here once and
 * every exporter gets it consistently.
 *
 * Out of the resolver's scope: `[[cite::…]]` and `[[quote::…]]`. Those
 * point at sources / excerpts whose output rendering is its own problem
 * (a citations ticket), so we leave them untouched and let the consumer
 * decide.
 */

import type { ExportPlan, LinkPolicy } from './types';

export interface LinkResolverContext {
  /**
   * Lookup from a wiki-link target (path without `.md`) to the title
   * we should surface in `inline-title` / `follow-to-file` rendering.
   */
  titleByTarget: Map<string, string>;
  /**
   * The set of note paths that are part of the export (e.g. `notes/foo.md`).
   * `follow-to-file` emits relative links only to members of this set.
   */
  includedPaths: Set<string>;
  linkPolicy: LinkPolicy;
}

/** Build a resolver context from a resolved export plan. */
export function buildLinkResolverContext(plan: ExportPlan): LinkResolverContext {
  const titleByTarget = new Map<string, string>();
  const includedPaths = new Set<string>();
  for (const f of plan.inputs) {
    if (f.kind !== 'note') continue;
    const stem = stripMdExt(f.relativePath);
    includedPaths.add(f.relativePath);
    titleByTarget.set(f.relativePath, f.title);
    titleByTarget.set(stem, f.title);
  }
  return { titleByTarget, includedPaths, linkPolicy: plan.linkPolicy };
}

/**
 * Resolve a single wiki-link reference into its rendered form. Returns a
 * markdown string — a plain run of text for `drop` / `inline-title`, or
 * a `[label](href)` link for `follow-to-file` when the target is in the
 * plan.
 */
export function resolveWikiLink(
  target: string,
  anchor: string | null,
  display: string | null,
  ctx: LinkResolverContext,
): string {
  const title = titleFor(target, ctx);
  switch (ctx.linkPolicy) {
    case 'drop':
      return display ?? title ?? target;
    case 'inline-title':
      return title ?? display ?? target;
    case 'follow-to-file': {
      const asMd = target.endsWith('.md') ? target : `${target}.md`;
      if (ctx.includedPaths.has(asMd)) {
        const label = display ?? title ?? target;
        const href = anchor ? `${asMd}#${anchor}` : asMd;
        return `[${label}](${href})`;
      }
      return title ?? display ?? target;
    }
  }
}

/**
 * Rewrite every wiki-link in `content` using the given resolver context.
 * `[[cite::…]]` and `[[quote::…]]` pass through verbatim — those are
 * source references, resolved by a separate mechanism.
 */
export function rewriteWikiLinksInContent(content: string, ctx: LinkResolverContext): string {
  // [[target]], [[target|display]], [[type::target]], [[type::target|display]]
  // with optional #anchor inside the target. Lazy target/display captures
  // to keep away from nested brackets in link text.
  const WIKI_LINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
  return content.replace(WIKI_LINK_RE, (full, rawTarget: string, display?: string) => {
    // Preserve cite / quote — those resolve through the citations path.
    if (/^(cite|quote)::/.test(rawTarget)) return full;
    // Strip a typed prefix (`references::`, `supports::`, …) from the
    // target for exporter purposes; we don't annotate link types in v1.
    const untyped = rawTarget.replace(/^[a-z][a-z0-9_]*::/, '');
    // Split anchor.
    const hashIdx = untyped.indexOf('#');
    const target = hashIdx >= 0 ? untyped.slice(0, hashIdx).trim() : untyped.trim();
    const anchor = hashIdx >= 0 ? untyped.slice(hashIdx + 1).trim() : null;
    if (!target) return full;
    return resolveWikiLink(target, anchor, display ? display.trim() : null, ctx);
  });
}

function titleFor(target: string, ctx: LinkResolverContext): string | null {
  return (
    ctx.titleByTarget.get(target) ??
    ctx.titleByTarget.get(stripMdExt(target)) ??
    ctx.titleByTarget.get(`${target}.md`) ??
    null
  );
}

function stripMdExt(p: string): string {
  return p.replace(/\.md$/i, '');
}
