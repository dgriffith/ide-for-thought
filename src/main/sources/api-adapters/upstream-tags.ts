/**
 * Shared helpers for #473 — turning upstream subject taxonomies into
 * Minerva tag strings.
 *
 * Each adapter prepends its own namespace prefix so a glance at the
 * tag tree tells you which API produced it. The slug rules below
 * match what the tag indexer's regex accepts
 * (`[a-zA-Z][\w-/]*` after the leading `#`).
 */

/**
 * Conservative slug for an upstream subject string. Lowercased, runs
 * of non-alphanumerics collapsed to a single hyphen, leading/trailing
 * hyphens trimmed.
 *
 * arXiv categories like `cs.LG` keep the dot? No — the tag regex
 * doesn't allow `.`, so we map it to a hyphen too. Result: `cs-lg`,
 * which is a small sacrifice for portability across the rest of the
 * tag system.
 */
export function slugForTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type UpstreamSource = 'crossref' | 'arxiv' | 'mesh';

/**
 * Turn a list of raw upstream subjects into the namespaced tag form
 * Minerva indexes. Drops empties and dedupes within the call so a
 * single subject doesn't show up twice on the source.
 */
export function buildUpstreamTags(source: UpstreamSource, raws: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    if (!raw) continue;
    const slug = slugForTag(raw);
    if (!slug) continue;
    const tag = `${source}/${slug}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}
