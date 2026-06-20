/**
 * The subset of formatter rules that are safe to run over a *pasted
 * fragment* (#160). Paste auto-formatting reuses the on-demand formatter
 * rules the user already enabled — there are no separate `*-on-paste`
 * toggles — but only the fragment-local ones may run, because the pasted
 * text is not the whole document.
 *
 * Excluded by design (would misbehave on a fragment):
 *   - whole-document rules — `unique-heading-slugs`, `unique-block-ids`,
 *     footnote re-indexing / relocation, `header-increment`
 *   - document-edge rules — `line-break-at-document-end`
 *   - filename/doc-dependent — `file-name-heading`
 *   - frontmatter (`yaml/*`, `canonicalize-frontmatter-keys`) — a paste
 *     into the body has no frontmatter to normalise
 *   - block-separation spacing (`empty-line-around-*`, `heading-blank-lines`)
 *     — these pad a block with surrounding blank lines, which is a
 *     whole-document concern, not a paste-range one
 *
 * Membership is keyed off the same rule ids the engine uses; a paste-safe
 * rule still only runs when the user has it enabled (`isRuleEnabled`).
 */

export const PASTE_SAFE_RULE_IDS: ReadonlySet<string> = new Set([
  // Inline text normalisations — purely local.
  'proper-ellipsis',
  'remove-multiple-spaces',
  'remove-hyphenated-line-breaks',
  'no-bare-urls',
  'quote-style',
  'emphasis-style',
  'strong-style',
  'blockquote-style',
  'auto-correct-common-misspellings',

  // List tidy — operates within the pasted lines.
  'remove-empty-list-markers',
  'remove-consecutive-list-markers',
  'unordered-list-marker-style',
  'ordered-list-style',

  // Heading text (not structure/levels) — local to the heading line.
  'remove-trailing-punctuation-in-heading',
  'capitalize-headings',

  // Whitespace within the fragment.
  'trailing-spaces',
  'consecutive-blank-lines',
  'space-after-list-marker',
  'remove-empty-lines-between-list-markers-and-checklists',
  'remove-link-spacing',
  'consistent-indentation',

  // Minerva link hygiene — rewrites the link text in place.
  'canonical-wiki-link-extension',
  'remove-redundant-wiki-link-display',
]);
