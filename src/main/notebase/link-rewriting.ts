/**
 * Rewrite wiki-link targets inside markdown content.
 *
 * Given a `rewrites` map of normalized old-path → new-path (no `.md`
 * suffix on either side), walk every `[[…]]` token in the content and
 * substitute matching targets while preserving:
 *
 *   - type prefix       `[[type::old]]`     → `[[type::new]]`
 *   - display text      `[[old|label]]`     → `[[new|label]]`
 *   - anchor suffix     `[[old#heading]]`   → `[[new#heading]]`
 *   - `.md` extension   `[[old.md]]`        → `[[new.md]]`
 *
 * Non-matching links, typed links pointing at sources/excerpts
 * (`[[cite::foo]]`, `[[quote::bar]]`), and tokens that don't look
 * like wiki-links at all are left untouched.
 */

import { WIKI_LINK_RE, parseWikiInner, reassembleWikiLink } from '../../shared/wiki-link';

/** Strip a trailing `.md` extension so rewrite keys match the indexer's convention. */
export function normalizePath(p: string): string {
  return p.replace(/\.md$/, '');
}

/**
 * Apply a rewrites map to all wiki-link targets in the content.
 * Returns the rewritten content (unchanged if nothing matched).
 */
export function rewriteWikiLinks(content: string, rewrites: Map<string, string>): string {
  if (rewrites.size === 0) return content;
  return content.replace(WIKI_LINK_RE, (match: string, inner: string) => {
    const parsed = parseWikiInner(inner);
    // Typed links that target non-notes (cite/quote) are out of scope —
    // their targets are ids, not paths. Skip them.
    if (parsed.type === 'cite' || parsed.type === 'quote') return match;

    const normalized = normalizePath(parsed.target);
    const newPath = rewrites.get(normalized);
    if (newPath === undefined) return match;

    const hadExtension = parsed.target.endsWith('.md');
    const finalTarget = hadExtension ? `${newPath}.md` : newPath;
    return reassembleWikiLink(parsed, finalTarget);
  });
}

/**
 * Rewrite the target id of every `[[<linkTypeName>::id]]` link whose id
 * appears in the rewrites map. Used for cite/quote renames where the
 * target is an id (not a path) and the type prefix is required to match.
 * Preserves anchor and display.
 */
export function rewriteTypedIdLinks(
  content: string,
  linkTypeName: string,
  rewrites: Map<string, string>,
): string {
  if (rewrites.size === 0) return content;
  return content.replace(WIKI_LINK_RE, (match: string, inner: string) => {
    const parsed = parseWikiInner(inner);
    if (parsed.type !== linkTypeName) return match;
    const newId = rewrites.get(parsed.target);
    if (newId === undefined) return match;
    return reassembleWikiLink(parsed, newId);
  });
}

/**
 * Rewrite the anchor portion of every wiki-link whose target path matches
 * `targetPath` (normalized) AND whose anchor equals `oldAnchor`. Preserves
 * the target path (including `.md` extension shape), the type prefix, and
 * the display text. Used when a heading in `targetPath` is renamed.
 */
export function rewriteAnchorInLinks(
  content: string,
  targetPath: string,
  oldAnchor: string,
  newAnchor: string,
): string {
  const normalizedTarget = normalizePath(targetPath);
  return content.replace(WIKI_LINK_RE, (match: string, inner: string) => {
    const parsed = parseWikiInner(inner);
    if (parsed.type === 'cite' || parsed.type === 'quote') return match;
    if (normalizePath(parsed.target) !== normalizedTarget) return match;
    // Compare without the leading `#` so callers can pass slugs directly.
    const currentAnchor = parsed.anchor?.startsWith('#') ? parsed.anchor.slice(1) : parsed.anchor;
    if (currentAnchor !== oldAnchor) return match;
    // Reassemble with the new anchor.
    const newAnchorText = newAnchor ? `#${newAnchor}` : '';
    const rewritten: typeof parsed = { ...parsed, anchor: newAnchorText || null };
    return reassembleWikiLink(rewritten, parsed.target);
  });
}

// ── Markdown links ──────────────────────────────────────────────────────────

/**
 * Markdown link / image syntax: `[text](url)`, `[text](url "title")`,
 * `![alt](url)`, `![alt](url "title")`. The text/alt may contain
 * balanced bracket pairs in standard markdown, but the bare `[^\]]*`
 * is good enough for the markdown the indexer's parser would have
 * accepted, since real-world unbalanced cases are vanishingly rare in
 * authored notes.
 *
 * Reference-style links (`[text][refId]` plus a `[refId]: url` block)
 * are intentionally out of scope — they're uncommon in this codebase
 * and adding them would significantly inflate this rewriter's surface.
 */
const MD_LINK_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;

/**
 * URL targets we never touch — absolute schemes go to the network or
 * desktop, fragment-only refs stay within the current document.
 */
function isUrlScheme(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

/**
 * Re-relativize markdown relative-path links and image refs in a
 * single file's content (#NEW). Two scenarios are handled in the
 * same pass:
 *
 *   - The file itself moved (sourcePathOld !== sourcePathNew):
 *     every relative link target is recomputed so it still resolves
 *     to the same absolute path from the new source location.
 *   - Some link target moved (its old absolute path is in
 *     `rewrites`): the target is updated to the new absolute path,
 *     then re-relativized from the (possibly new) source location.
 *
 * Both passes happen in one walk so a single file rewrite handles
 * "this file moved AND links to other files that also moved". URL-
 * scheme targets, fragment-only refs, and protocol-relative `//host`
 * links pass through untouched.
 */
export function rewriteRelativeMarkdownLinks(
  content: string,
  sourcePathOld: string,
  sourcePathNew: string,
  rewrites: Map<string, string>,
): string {
  const sourceMoved = sourcePathOld !== sourcePathNew;
  // Cheap exit: if nothing about this file's situation can change a
  // link, return as-is. Saves a regex scan on the common case where
  // a rename touches only a small slice of the project.
  if (!sourceMoved && rewrites.size === 0) return content;

  return content.replace(MD_LINK_RE, (match, bang: string, text: string, urlRaw: string, titleSuffix: string | undefined) => {
    const trimmed = urlRaw.trim();
    if (!trimmed) return match;
    if (trimmed.startsWith('#')) return match; // same-doc anchor
    if (isUrlScheme(trimmed)) return match;

    // Pull off any anchor; we don't want it to be confused with a path
    // separator and we round-trip it untouched.
    const hashIdx = trimmed.indexOf('#');
    const pathPart = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
    const anchor = hashIdx >= 0 ? trimmed.slice(hashIdx) : '';

    // Markdown URL-encodes special chars (notably spaces as %20). The
    // path arithmetic happens on decoded values; we re-encode at the
    // end so we don't double-encode and we don't introduce raw spaces
    // into a markdown URL.
    let decoded: string;
    try {
      decoded = decodeURI(pathPart);
    } catch {
      return match; // malformed URI escape — leave untouched
    }

    // Resolve the link's target as an absolute-from-root path, using
    // the file's OLD location as the resolution base because that's
    // where the link was authored relative to.
    const sourceDirOld = posixDirname(sourcePathOld);
    const absOld = posixNormalize(joinPosix(sourceDirOld, decoded));
    if (absOld === null) return match; // link escapes the project root

    // Look up in the rewrites map: if the target moved, swap to its new
    // absolute path; otherwise keep the original absolute path.
    const absNew = rewrites.get(absOld) ?? absOld;

    // Bail if neither end of the relationship moved — nothing to do.
    if (!sourceMoved && absNew === absOld) return match;

    // Re-relativize from the (possibly new) source location to the
    // (possibly new) target absolute path.
    const sourceDirNew = posixDirname(sourcePathNew);
    const newRelative = posixRelative(sourceDirNew, absNew);
    const reEncoded = encodeMarkdownUrl(newRelative);
    return `${bang}[${text}](${reEncoded}${anchor}${titleSuffix ?? ''})`;
  });
}

// ── posix-path helpers (rewriting works on relativePaths, not OS paths) ───

function posixDirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx < 0 ? '' : p.slice(0, idx);
}

function joinPosix(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a}/${b}`;
}

/**
 * Normalize a posix path: collapse `./`, resolve `../` segments. Returns
 * null if the path tries to escape the project root (more `../` than
 * the depth allows) — the caller treats that as an out-of-scope link
 * and leaves it alone.
 */
function posixNormalize(p: string): string | null {
  const segments = p.split('/');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

/**
 * Compute a relative path from `fromDir` to `toPath` (both treated as
 * posix-style, root-relative). The result starts with `./` when both
 * sides are in the same directory so the link visually reads as
 * relative — matches the convention authored notes typically use.
 */
function posixRelative(fromDir: string, toPath: string): string {
  const fromSegs = fromDir ? fromDir.split('/') : [];
  const toSegs = toPath ? toPath.split('/') : [];
  let common = 0;
  while (common < fromSegs.length && common < toSegs.length && fromSegs[common] === toSegs[common]) {
    common++;
  }
  const ups = fromSegs.length - common;
  const downs = toSegs.slice(common);
  const upParts: string[] = Array.from({ length: ups }, () => '..');
  const parts = [...upParts, ...downs];
  if (parts.length === 0) return '.';
  if (ups === 0) return `./${parts.join('/')}`;
  return parts.join('/');
}

/** Encode a path back into the URL form markdown allows. */
function encodeMarkdownUrl(p: string): string {
  // Per RFC 3986, path segments may contain unreserved chars + a few
  // sub-delims. Encoding spaces (most common) and a small set of chars
  // markdown parsers stumble on is enough; keep `/` and `.` raw.
  return p.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}
