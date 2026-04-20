/**
 * Side-effect barrel that registers every formatter rule (#155–#161).
 * Importing this module causes each rule file to run its `registerRule`
 * call, populating the shared registry before the engine consults it.
 *
 * Order within a category is the registration-and-apply order. Category
 * application order itself is fixed by CATEGORY_ORDER in registry.ts.
 */

// Spacing (#158) — blank-line discipline and inline whitespace normalisation.
import './spacing/line-break-at-document-end';
import './spacing/trailing-spaces';
import './spacing/space-after-list-marker';
import './spacing/consecutive-blank-lines';

export {};
