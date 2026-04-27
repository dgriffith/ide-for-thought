/**
 * Registry of every \`showConfirm\` key in the app. Each entry gives the
 * Behaviors settings tab a human-readable row so users can see what
 * they've muted and re-enable it.
 *
 * Call sites reference the CONFIRM_KEYS constants rather than passing
 * bare strings, so adding a new confirm requires adding its entry here.
 * A guard test (tests/renderer/confirm-keys.test.ts) checks for drift.
 */

export const CONFIRM_KEYS = {
  delete: 'confirm-delete',
  deleteSource: 'delete-source',
  rewriteConflict: 'confirm-rewrite-conflict',
  headingRenameSuggestion: 'heading-rename-suggestion',
  moveCollision: 'move-collision',
  copyCollision: 'copy-collision',
  autoTagNoSuggestions: 'auto-tag-no-suggestions',
  autoTagFailed: 'auto-tag-failed',
  autoLinkNoSuggestions: 'auto-link-no-suggestions',
  autoLinkFailed: 'auto-link-failed',
  decomposeFailed: 'decompose-failed',
  decomposeBadProposal: 'decompose-bad-proposal',
  decomposeClaimsNoClaims: 'decompose-claims-no-claims',
  decomposeClaimsFiled: 'decompose-claims-filed',
  decomposeClaimsFailed: 'decompose-claims-failed',
  formatFailed: 'format-failed',
  formatComplete: 'format-complete',
  formatAllConfirm: 'format-all-confirm',
  ingestDuplicate: 'ingest-duplicate',
  ingestFailed: 'ingest-failed',
  ingestPdfFailed: 'ingest-pdf-failed',
  dropImportRejected: 'drop-import-rejected',
  bibtexImportComplete: 'bibtex-import-complete',
  zoteroRdfImportComplete: 'zotero-rdf-import-complete',
  saveCellOutputFailed: 'save-cell-output-failed',
  exportComplete: 'export-complete',
} as const;

export type ConfirmKey = typeof CONFIRM_KEYS[keyof typeof CONFIRM_KEYS];

export interface ConfirmRegistryEntry {
  key: ConfirmKey;
  title: string;
  description: string;
}

export const CONFIRM_REGISTRY: ConfirmRegistryEntry[] = [
  {
    key: CONFIRM_KEYS.delete,
    title: 'Delete file or folder',
    description:
      'Prompt before removing a note, folder, or source from the thoughtbase.',
  },
  {
    key: CONFIRM_KEYS.deleteSource,
    title: 'Delete source',
    description:
      'Prompt before removing a Source (and its excerpts) from the thoughtbase.',
  },
  {
    key: CONFIRM_KEYS.rewriteConflict,
    title: 'Reload note rewritten on disk',
    description:
      'Prompt when an external link rewrite touches a file you have unsaved changes in.',
  },
  {
    key: CONFIRM_KEYS.headingRenameSuggestion,
    title: 'Update links after heading rename',
    description:
      'Offer to rewrite incoming [[note#heading]] links when a heading edit looks like a rename.',
  },
  {
    key: CONFIRM_KEYS.moveCollision,
    title: 'Move cancelled (destination exists)',
    description:
      'Shown when Move would overwrite an existing file at the chosen destination.',
  },
  {
    key: CONFIRM_KEYS.copyCollision,
    title: 'Copy cancelled (destination exists)',
    description:
      'Shown when Copy would overwrite an existing file at the chosen destination.',
  },
  {
    key: CONFIRM_KEYS.autoTagNoSuggestions,
    title: 'Auto-tag returned no new tags',
    description:
      'Shown when the LLM produced no tag suggestions for the note (usually because it is too short or already well-tagged).',
  },
  {
    key: CONFIRM_KEYS.autoTagFailed,
    title: 'Auto-tag failed',
    description:
      'Shown when Auto-tag errors out (network failure, missing API key, etc).',
  },
  {
    key: CONFIRM_KEYS.autoLinkNoSuggestions,
    title: 'Auto-link returned no suggestions',
    description:
      'Shown when the LLM produced no link candidates for the note.',
  },
  {
    key: CONFIRM_KEYS.autoLinkFailed,
    title: 'Auto-link failed',
    description:
      'Shown when Auto-link errors out or can\u2019t apply any accepted suggestions.',
  },
  {
    key: CONFIRM_KEYS.decomposeFailed,
    title: 'Decompose Note failed',
    description:
      'Shown when Decompose Note errors out (network failure, missing API key, etc).',
  },
  {
    key: CONFIRM_KEYS.decomposeBadProposal,
    title: 'Decompose Note returned an unusable proposal',
    description:
      'Shown when the LLM\u2019s response can\u2019t be parsed into a valid parent + children structure.',
  },
  {
    key: CONFIRM_KEYS.decomposeClaimsNoClaims,
    title: 'Decompose into Claims: no claims found',
    description:
      'Shown when the LLM did not extract any claims from the selected passage (usually because the passage is too short or contains only questions / hedges).',
  },
  {
    key: CONFIRM_KEYS.decomposeClaimsFiled,
    title: 'Decompose into Claims: proposal filed',
    description:
      'Shown after Decompose into Claims successfully extracts N claims and files them as a single Proposal — review in the Proposals panel.',
  },
  {
    key: CONFIRM_KEYS.decomposeClaimsFailed,
    title: 'Decompose into Claims failed',
    description:
      'Shown when Decompose into Claims errors out (network failure, missing API key, malformed LLM response, etc).',
  },
  {
    key: CONFIRM_KEYS.formatFailed,
    title: 'Format failed',
    description:
      'Shown when the formatter errors out during a Format command.',
  },
  {
    key: CONFIRM_KEYS.formatComplete,
    title: 'Format batch complete',
    description:
      'Summary dialog after Format Folder / Format All Notes finishes (counts changed + scanned files).',
  },
  {
    key: CONFIRM_KEYS.formatAllConfirm,
    title: 'Confirm Format All Notes',
    description:
      'Prompt before running the formatter across the whole thoughtbase.',
  },
  {
    key: CONFIRM_KEYS.ingestDuplicate,
    title: 'Ingest URL: already ingested',
    description:
      'Shown when the URL you tried to ingest matches an existing source — the source is opened instead of creating a duplicate.',
  },
  {
    key: CONFIRM_KEYS.ingestFailed,
    title: 'Ingest URL failed',
    description:
      'Shown when Ingest URL errors out (network failure, unsupported content type, Readability extraction failed, etc).',
  },
  {
    key: CONFIRM_KEYS.ingestPdfFailed,
    title: 'Ingest identifier: PDF fetch failed',
    description:
      'Shown when identifier ingest succeeds on metadata but the advertised open-access PDF cannot be fetched (paywall, 403, network error). The source lands without the PDF.',
  },
  {
    key: CONFIRM_KEYS.dropImportRejected,
    title: 'Drag-drop ingestion: some files skipped',
    description:
      'Shown after a multi-file drag-drop when one or more files were rejected (unsupported extension, read error, etc). Supported files still land.',
  },
  {
    key: CONFIRM_KEYS.bibtexImportComplete,
    title: 'BibTeX import complete',
    description:
      'Summary dialog after Import BibTeX finishes (counts of imported / duplicate / failed entries).',
  },
  {
    key: CONFIRM_KEYS.zoteroRdfImportComplete,
    title: 'Zotero RDF import complete',
    description:
      'Summary dialog after Import Zotero RDF finishes (counts of imported / duplicate / failed items, and how many PDFs were lifted).',
  },
  {
    key: CONFIRM_KEYS.saveCellOutputFailed,
    title: 'Save cell output failed',
    description:
      'Shown when "Save as note" on a compute-cell output errors out (path collision, write error, etc). Kept separate from ingest-failed so suppressing one doesn\'t mute the other.',
  },
  {
    key: CONFIRM_KEYS.exportComplete,
    title: 'Export complete',
    description:
      'Summary dialog after an export finishes (how many files were written and to which directory).',
  },
];

const byKey = new Map(CONFIRM_REGISTRY.map((e) => [e.key, e]));

export function confirmRegistryEntry(key: string): ConfirmRegistryEntry | null {
  return byKey.get(key as ConfirmKey) ?? null;
}
