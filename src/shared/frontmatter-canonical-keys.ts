/**
 * Canonical frontmatter keys Minerva understands as first-class
 * predicates. Used by the Properties panel as a secondary source of
 * autocomplete suggestions (#488): the project's actually-in-use keys
 * come first, then this list backfills well-known options that the
 * user might want even if no note has them yet.
 *
 * Deliberately mirrored — not imported — from
 * `src/main/graph/frontmatter-predicates.ts`. That module is main-only
 * (it pulls in graph types) and the renderer can't import from main.
 * The two lists must stay in sync, but the surface is small and easy
 * to spot during review.
 *
 * Only canonical forms are listed. Aliases (`author`, `lang`, `date`,
 * `url`, `pageRange`) are deliberately omitted — see
 * `src/shared/formatter/rules/minerva/canonicalize-frontmatter-keys.ts`
 * for the alias → canonical mapping. Suggesting aliases would push
 * users toward keys that get rewritten away by the formatter.
 */
export const CANONICAL_FRONTMATTER_KEYS: readonly string[] = [
  // Dublin Core
  'title',
  'creator',
  'description',
  'abstract',
  'publisher',
  'language',
  'subject',
  'created',
  'modified',
  'issued',

  // BIBO (bibliographic)
  'doi',
  'isbn',
  'uri',
  'pages',
  'volume',
  'issue',
  'numPages',

  // schema.org
  'inContainer',

  // thought:* (source + analysis bits)
  'accessedAt',
  'archivedAt',
  'supports',
  'rebuts',
  'claim-kind',
  'source-text',
  'extracted-by',
  'extracted-from',
  'decomposes',

  // prov:* (provenance — derived notes)
  'derived_from',
  'derived_at',
  'derived_from_cell',

  // Universally-supported but predicate-free
  'tags',
];
