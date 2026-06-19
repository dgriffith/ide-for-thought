/**
 * The "house style" — the curated set of formatter rules that ship enabled
 * by default. Every other rule stays off until the user turns it on.
 *
 * Selection principle: a rule earns a place here only if it is **safe and
 * uncontroversial** — it tidies whitespace, frontmatter shape, list markers,
 * or Minerva-specific link hygiene without ever changing the *meaning* of
 * prose, headings levels, or content words. Anything opinionated (title-case
 * headings, smart-quote substitution, footnote relocation, spelling
 * autocorrect, key sorting) is deliberately excluded so the default never
 * surprises a writer.
 *
 * How the default is honoured: the engine treats a rule as enabled when the
 * user's `enabled` map has no entry for it AND it appears here
 * (`settings.enabled[id] ?? HOUSE_STYLE_RULE_IDS.has(id)` — see
 * `isRuleEnabled` in engine.ts). An explicit `false` from the Formatter
 * settings tab always wins, so a user can switch any house-style rule off.
 */

export const HOUSE_STYLE_RULE_IDS: ReadonlySet<string> = new Set([
  // Whitespace discipline — pure cosmetic tidy, never alters meaning.
  'trailing-spaces',
  'line-break-at-document-end',
  'consecutive-blank-lines',
  'space-after-list-marker',
  'heading-blank-lines',
  'empty-line-around-code-fences',
  'empty-line-around-tables',
  'empty-line-around-math-blocks',
  'empty-line-around-blockquotes',
  'empty-line-around-horizontal-rules',

  // Frontmatter shape — structural tidy of the YAML block, no value rewrites
  // beyond dropping duplicate array entries.
  'add-blank-line-after-yaml',
  'compact-yaml',
  'dedupe-yaml-array-values',

  // Inline + list tidy — collapse stray spacing and unify bullet markers.
  'remove-multiple-spaces',
  'remove-empty-list-markers',
  'remove-consecutive-list-markers',
  'unordered-list-marker-style',

  // Minerva link hygiene — canonicalise wiki-links and frontmatter predicate
  // keys so the graph indexes consistently.
  'canonical-wiki-link-extension',
  'remove-redundant-wiki-link-display',
  'canonicalize-frontmatter-keys',
]);
