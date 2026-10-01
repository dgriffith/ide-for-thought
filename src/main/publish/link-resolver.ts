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
 *
 * **A link resolves to exactly the note the app would open (#2518).** Exports
 * used to match only a target's full thoughtbase-relative path, so the common
 * `[[Note Name]]`, a note-relative `[[sub/Note]]`, an alias and a case variant
 * all exported as dead text — even with the target in the export. Every
 * lookup now goes through `resolveTarget`: the app's own
 * `resolveWikiLinkTarget`, over the WHOLE thoughtbase's notes and alias map
 * (the plan's `linkTargets`, from the graph). Resolving against only the
 * exported notes would be wrong in a quieter way — a fuzzy step could land on
 * a different, included note than the one the app opens. Inclusion is asked
 * afterwards, of the note the link really names.
 */

import path from 'node:path';
import type { ExportPlan, LinkPolicy } from './types';
import { resolveWikiLinkTarget } from '../../shared/wiki-link-resolver';

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
  /** The note a wiki-link target names, resolved as the app resolves it
   *  (#2518) — thoughtbase-relative with its real extension — or null. */
  resolveTarget: (target: string) => string | null;
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
  const targets = plan.linkTargets ?? linkTargetsFromInputs(plan);
  const files = targets.paths.map((relativePath) => ({ relativePath, isDirectory: false }));
  const memo = new Map<string, string | null>();
  const resolveTarget = (target: string): string | null => {
    let hit = memo.get(target);
    if (hit === undefined) {
      hit = resolveWikiLinkTarget(target, files, targets.aliases);
      memo.set(target, hit);
    }
    return hit;
  };
  return { titleByTarget, includedPaths, linkPolicy: plan.linkPolicy, resolveTarget };
}

/**
 * Without the graph (a test, or a project that isn't indexed yet), resolve
 * against the exported notes and their own frontmatter aliases — the best
 * available stand-in for the thoughtbase's link targets.
 */
function linkTargetsFromInputs(plan: ExportPlan): { paths: string[]; aliases: Record<string, string> } {
  const paths: string[] = [];
  const aliases: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const f of plan.inputs) {
    if (f.kind !== 'note') continue;
    paths.push(f.relativePath);
    const fm = f.frontmatter as Record<string, unknown> | undefined;
    for (const key of ['aliases', 'alias']) {
      const v = fm?.[key];
      for (const a of Array.isArray(v) ? v : [v]) {
        if (typeof a !== 'string' || !a.trim()) continue;
        const k = a.trim().toLowerCase();
        if (!(k in aliases)) aliases[k] = f.relativePath;
      }
    }
  }
  return { paths, aliases };
}

/**
 * A link destination safe in markdown and HTML: spaces and the characters
 * that end or confuse a CommonMark destination are percent-encoded, so
 * `Kampa Museum.md` stays one link in GitHub, Hugo and every other renderer
 * (#2518). Everything else — letters in any script, `/`, `#` — stays readable.
 */
export function encodeLinkDestination(href: string): string {
  return href.replace(/[ ()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
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
  fromPath?: string,
): string {
  const resolved = ctx.resolveTarget(target);
  const title = resolved ? titleFor(resolved, ctx) : null;
  switch (ctx.linkPolicy) {
    case 'drop':
      return display ?? title ?? target;
    case 'inline-title':
      return title ?? display ?? target;
    case 'follow-to-file': {
      if (resolved && ctx.includedPaths.has(resolved)) {
        const label = display ?? title ?? target;
        const rel = relativeTarget(fromPath, resolved);
        const href = anchor ? `${rel}#${anchor}` : rel;
        return `[${label}](${encodeLinkDestination(href)})`;
      }
      return title ?? display ?? target;
    }
  }
}

/**
 * A link href relative to the linking note's folder. `fromPath` is the note
 * being rendered; without it (single-file exports) the target's project-root-
 * relative path is kept. For directory-tree exports that mirror the note
 * folders (markdown / tree-markdown), a root-relative href would double the
 * folder when the linking note itself sits in a subfolder — so relativize.
 */
function relativeTarget(fromPath: string | undefined, asMd: string): string {
  if (!fromPath) return asMd;
  const rel = path.posix.relative(path.posix.dirname(fromPath), asMd);
  return rel === '' ? path.posix.basename(asMd) : rel;
}

/**
 * Rewrite every wiki-link in `content` using the given resolver context.
 * `[[cite::…]]` and `[[quote::…]]` pass through verbatim — those are
 * source references, resolved by a separate mechanism.
 */
export function rewriteWikiLinksInContent(
  content: string,
  ctx: LinkResolverContext,
  fromPath?: string,
): string {
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
    return resolveWikiLink(target, anchor, display ? display.trim() : null, ctx, fromPath);
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
