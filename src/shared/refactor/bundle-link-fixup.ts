/**
 * Post-process a propose_notes bundle's wiki-links so links between
 * sibling notes resolve. The LLM frequently picks human-readable
 * relativePaths ("notes/learning-journeys/type-theory/Sets, Functions,
 * and the Need for Types.md") AND links them with shorter convenience
 * names ("[[stop-1]]", "[[Sets and Functions]]") — those don't resolve.
 *
 * This pass walks every note in the bundle, looks at each [[…]] link
 * inside its content, and tries to map the target to one of the
 * sibling basenames using a few fallback matchers. When a match lands,
 * the link target is rewritten to the sibling's exact basename. When
 * nothing matches, the link is left as the model wrote it (it might
 * point to a real existing note outside the bundle).
 */

import { WIKI_LINK_RE, parseWikiInner, reassembleWikiLink } from '../wiki-link';

export interface BundleNote {
  relativePath: string;
  content: string;
}

interface SiblingIndex {
  /** Bundle's siblings keyed by their canonical (slugified) basename. */
  bySlug: Map<string, string>;
  /** Same keyed by lowercased basename. */
  byLower: Map<string, string>;
  /** Exact basenames in the bundle (used as the values both maps point at). */
  basenames: string[];
}

function basenameOf(relativePath: string): string {
  const parts = relativePath.split('/');
  const last = parts[parts.length - 1] ?? relativePath;
  return last.replace(/\.(md|ttl)$/i, '');
}

/** Lowercase, replace non-alphanumeric with `-`, collapse runs, trim hyphens. */
export function slugifyForLink(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildIndex(notes: BundleNote[]): SiblingIndex {
  const bySlug = new Map<string, string>();
  const byLower = new Map<string, string>();
  const basenames: string[] = [];
  for (const n of notes) {
    const base = basenameOf(n.relativePath);
    basenames.push(base);
    bySlug.set(slugifyForLink(base), base);
    byLower.set(base.toLowerCase(), base);
  }
  return { bySlug, byLower, basenames };
}

/**
 * Try to find the sibling basename a wiki-link target was meant to
 * point at. Returns null when the target doesn't look like a sibling
 * link (e.g. matches an exact basename — already correct — or doesn't
 * look like any sibling at all).
 *
 * Order:
 *   1. Exact basename match → already correct, no rewrite needed.
 *   2. Slugified target matches a sibling's slug.
 *   3. Lowercased target matches a sibling's lowercased basename.
 *   4. The target is the slug of one sibling but spelled with hyphens
 *      while the bundle uses spaces (or vice versa).
 */
export function resolveBundleTarget(
  target: string,
  index: SiblingIndex,
): string | null {
  // Already correct
  if (index.basenames.includes(target)) return null;

  const slug = slugifyForLink(target);
  const slugMatch = index.bySlug.get(slug);
  if (slugMatch) return slugMatch;

  const lower = index.byLower.get(target.toLowerCase());
  if (lower) return lower;

  return null;
}

/**
 * Walk every note's content and rewrite inter-bundle wiki-link
 * targets to sibling basenames. Returns a new array of notes; inputs
 * are not mutated. Reports a per-note count of links rewritten.
 */
export interface BundleLinkFixupResult {
  notes: BundleNote[];
  rewritten: Array<{ relativePath: string; rewrites: Array<{ from: string; to: string }> }>;
}

export function fixupBundleLinks(notes: BundleNote[]): BundleLinkFixupResult {
  const index = buildIndex(notes);
  const rewritten: BundleLinkFixupResult['rewritten'] = [];

  const fixed = notes.map((n) => {
    const localRewrites: Array<{ from: string; to: string }> = [];
    const newContent = n.content.replace(WIKI_LINK_RE, (match, inner: string) => {
      const parsed = parseWikiInner(inner);
      // Skip typed links (cite::, supports::, etc) — those don't point
      // at notes by basename.
      if (parsed.type) return match;
      const resolved = resolveBundleTarget(parsed.target, index);
      if (!resolved || resolved === parsed.target) return match;
      localRewrites.push({ from: parsed.target, to: resolved });
      return reassembleWikiLink(parsed, resolved);
    });
    if (localRewrites.length > 0) {
      rewritten.push({ relativePath: n.relativePath, rewrites: localRewrites });
    }
    return { relativePath: n.relativePath, content: newContent };
  });

  return { notes: fixed, rewritten };
}
