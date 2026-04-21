/**
 * Side-effect barrel that registers every formatter rule (#155–#161).
 * Importing this module causes each rule file to run its `registerRule`
 * call, populating the shared registry before the engine consults it.
 *
 * Order within a category is the registration-and-apply order. Category
 * application order itself is fixed by CATEGORY_ORDER in registry.ts.
 */

// Heading (#156) — ATX heading structure and text.
import './heading/header-increment';
import './heading/remove-trailing-punctuation';
import './heading/capitalize-headings';
import './heading/file-name-heading';

// Content (#157) — in-line text normalisations.
import './content/proper-ellipsis';
import './content/remove-multiple-spaces';
import './content/remove-hyphenated-line-breaks';
import './content/no-bare-urls';
import './content/default-language-for-code-fences';
import './content/quote-style';
import './content/emphasis-style';
import './content/strong-style';
import './content/blockquote-style';
// List normalisation — empty/consecutive cleanups run before the style rules
// so renumbering sees a tidy list.
import './content/remove-empty-list-markers';
import './content/remove-consecutive-list-markers';
import './content/unordered-list-marker-style';
import './content/ordered-list-style';
import './content/auto-correct-common-misspellings';

// Spacing (#158) — blank-line discipline and inline whitespace normalisation.
import './spacing/line-break-at-document-end';
import './spacing/trailing-spaces';
import './spacing/space-after-list-marker';
import './spacing/remove-link-spacing';
import './spacing/remove-empty-lines-between-list-items';
import './spacing/consistent-indentation';
// Move math indicators BEFORE the blank-line-around-math rule so the
// latter sees already-split $$…$$ blocks.
import './spacing/move-math-block-indicators';
import './spacing/empty-line-around-code-fences';
import './spacing/empty-line-around-blockquotes';
import './spacing/empty-line-around-math-blocks';
import './spacing/empty-line-around-horizontal-rules';
import './spacing/empty-line-around-tables';
import './spacing/heading-blank-lines';
import './spacing/consecutive-blank-lines';

export {};
