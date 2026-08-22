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
  /** Restoring a note to a history revision — non-destructive (the restore is
   *  itself a new revision), so the confirm is dismissable. (#1158) */
  historyRestore: 'history-restore',
  /** Summary after labeling the current version of a sidebar selection. */
  historyLabelComplete: 'history-label-complete',
  /** Resetting every skill's model to its default on a chosen provider —
   *  overwrites per-skill pins, so it asks first. */
  resetSkillModels: 'reset-skill-models',
  deletePartialFailure: 'delete-partial-failure',
  deleteSource: 'delete-source',
  /** Closing a conversation archives it, and there's no reopen UI — so it's
   *  effectively gone. Confirm before discarding the thread (#1033). */
  closeConversation: 'close-conversation',
  rewriteConflict: 'confirm-rewrite-conflict',
  headingRenameSuggestion: 'heading-rename-suggestion',
  /** "Bookmark Section" invoked with the cursor above the first heading —
   *  there's no section to anchor to. (#755) */
  bookmarkSectionNoHeading: 'bookmark-section-no-heading',
  moveCollision: 'move-collision',
  copyCollision: 'copy-collision',
  autoTagNoSuggestions: 'auto-tag-no-suggestions',
  autoTagFailed: 'auto-tag-failed',
  autoLinkNoSuggestions: 'auto-link-no-suggestions',
  autoLinkFailed: 'auto-link-failed',
  decomposeFailed: 'decompose-failed',
  decomposeBadProposal: 'decompose-bad-proposal',
  /** Generic — shown when a conversational tool's `buildSystemPrompt`
   *  throws (e.g. Find Supporting/Opposing Arguments was invoked with
   *  no claim under the cursor). The message body comes from the
   *  thrown Error, so a single key covers all such tools. */
  toolPrepareFailed: 'tool-prepare-failed',
  bulkTagFailed: 'bulk-tag-failed',
  bulkTagComplete: 'bulk-tag-complete',
  bulkTagNoSelection: 'bulk-tag-no-selection',
  bulkTagNoTagsOnSelection: 'bulk-tag-no-tags-on-selection',
  bulkPropertyFailed: 'bulk-property-failed',
  bulkPropertyComplete: 'bulk-property-complete',
  bulkPropertyNoKeysOnSelection: 'bulk-property-no-keys-on-selection',
  formatFailed: 'format-failed',
  formatComplete: 'format-complete',
  formatAllConfirm: 'format-all-confirm',
  ingestDuplicate: 'ingest-duplicate',
  ingestFailed: 'ingest-failed',
  ingestPdfFailed: 'ingest-pdf-failed',
  /** DOI clicked in the preview that doesn't match an existing source
   *  yet (#473). User confirms before we hit CrossRef. */
  ingestDoiFromBody: 'ingest-doi-from-body',
  /** Reference mining produced no candidates (#106). */
  mineReferencesEmpty: 'mine-references-empty',
  /** Reference mining or stub-materialisation failed (#106). */
  mineReferencesFailed: 'mine-references-failed',
  /** Per-stub creation summary after reference-mining approval (#106). */
  mineReferencesResult: 'mine-references-result',
  /** Stub-resolve flow signals (#107). */
  resolveStubEmpty: 'resolve-stub-empty',
  resolveStubFailed: 'resolve-stub-failed',
  resolveStubApplied: 'resolve-stub-applied',
  /** "Create note from conversation" outcomes (#177). */
  createNoteFromConvEmpty: 'create-note-from-conv-empty',
  createNoteFromConvFailed: 'create-note-from-conv-failed',
  /** Two CSVs derived the same DuckDB table name; the second was
   *  skipped (#354). The user can fix by adding `table_name:` to a
   *  companion .md. */
  tableNameCollision: 'table-name-collision',
  dropImportRejected: 'drop-import-rejected',
  bibtexImportComplete: 'bibtex-import-complete',
  zoteroRdfImportComplete: 'zotero-rdf-import-complete',
  saveCellOutputFailed: 'save-cell-output-failed',
  /** Image-upload rejection toast (#455) — too-large, unsupported MIME, etc. */
  imageUploadFailed: 'image-upload-failed',
  /** First-run compute trust dialog (#373, #1325). Covers every
   *  executable fence (Python, SQL, SPARQL). The dialog hides the
   *  Don't-ask-again checkbox — consent is project-scoped, not
   *  machine-scoped, so the localStorage suppression mustn't fire.
   *  The `python-trust` key string is historical (kept so existing
   *  per-project consent still resolves). */
  pythonTrust: 'python-trust',
  exportComplete: 'export-complete',
  /** Pre-merge confirmation (#464) — surfaced before "Merge note into…" runs. */
  mergeNote: 'merge-note',
  /** Surfaced when the merge IPC throws after the user confirmed (rare). */
  mergeFailed: 'merge-failed',
  /** Surfaced when a duplicate-source merge (inspection quick-fix) fails (#1446). */
  mergeSourcesFailed: 'merge-sources-failed',
  bibliographyResult: 'bibliography-result',
  bibliographyFailed: 'bibliography-failed',
  /** Shown when an LLM-backed action runs without an Anthropic API key
   *  configured. The confirm button label is "Open Settings" and the
   *  dialog hides the Don't-ask-again checkbox — silencing it would
   *  return the user to the previous silent-fail behavior. */
  missingApiKey: 'missing-api-key',
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
    key: CONFIRM_KEYS.historyRestore,
    title: 'Restore note from history',
    description:
      'Prompt before restoring a note to an earlier version from its local history. Non-destructive — the current text is kept as a new revision — so this is easy to turn off.',
  },
  {
    key: CONFIRM_KEYS.resetSkillModels,
    title: 'Reset skill models to defaults',
    description:
      'Confirm before replacing every per-skill model pin with the default for that skill on the chosen provider. Menus, ordering, and which skills are enabled are unaffected.',
  },
  {
    key: CONFIRM_KEYS.historyLabelComplete,
    title: 'Label Version complete',
    description:
      'Summary dialog after labeling the current version of a sidebar selection (how many notes got the named restore point, and any per-note failures).',
  },
  {
    key: CONFIRM_KEYS.deletePartialFailure,
    title: 'Delete: partial failure',
    description:
      'Shown after a multi-select Delete when some items could not be removed (e.g. permissions, file in use). Lists the failures so the user can investigate without re-issuing the whole delete.',
  },
  {
    key: CONFIRM_KEYS.closeConversation,
    title: 'Close conversation',
    description:
      'Prompt before closing a conversation. Closing archives the thread and there is no way to reopen it, so this guards against losing a conversation to a stray click.',
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
    key: CONFIRM_KEYS.bookmarkSectionNoHeading,
    title: 'Bookmark Section: no heading above cursor',
    description:
      'Shown when "Bookmark Section" is invoked with the cursor sitting before the note’s first heading, so there is no section to anchor the bookmark to.',
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
    key: CONFIRM_KEYS.toolPrepareFailed,
    title: 'Tool could not start',
    description:
      'Shown when a conversational tool refuses to start with a user-facing reason (e.g. missing context like a claim under the cursor). The dialog body carries the specific reason from the tool.',
  },
  {
    key: CONFIRM_KEYS.bulkTagComplete,
    title: 'Bulk Add/Remove Tag complete',
    description:
      'Summary dialog after a sidebar Add Tag / Remove Tag operation finishes (counts of notes changed and any per-note failures).',
  },
  {
    key: CONFIRM_KEYS.bulkTagFailed,
    title: 'Bulk Add/Remove Tag failed',
    description:
      'Shown when a bulk tag operation fails outright (e.g. fetching the tag vocabulary errored before the loop started).',
  },
  {
    key: CONFIRM_KEYS.bulkTagNoSelection,
    title: 'Bulk Tag: no .md files in selection',
    description:
      'Shown when Add Tag / Remove Tag is invoked on a sidebar selection that resolves to no .md files (e.g. only a .csv file selected).',
  },
  {
    key: CONFIRM_KEYS.bulkTagNoTagsOnSelection,
    title: 'Remove Tag: selection has no tags',
    description:
      'Shown when Remove Tag is invoked on a selection whose notes have no frontmatter tags — there is nothing to remove.',
  },
  {
    key: CONFIRM_KEYS.bulkPropertyComplete,
    title: 'Add/Remove Property complete',
    description:
      'Summary dialog after an Add Property / Remove Property operation finishes (counts of notes changed and any per-note failures).',
  },
  {
    key: CONFIRM_KEYS.bulkPropertyFailed,
    title: 'Add/Remove Property failed',
    description:
      'Shown when a property operation fails outright (e.g. fetching the frontmatter-key vocabulary errored before the loop started).',
  },
  {
    key: CONFIRM_KEYS.bulkPropertyNoKeysOnSelection,
    title: 'Remove Property: selection has no properties',
    description:
      'Shown when Remove Property is invoked on a selection whose notes have no frontmatter properties — there is nothing to remove.',
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
    key: CONFIRM_KEYS.ingestDoiFromBody,
    title: 'Ingest DOI from body',
    description:
      'Shown when you click a bare DOI in the preview that doesn\'t match an existing source — confirms before fetching CrossRef.',
  },
  {
    key: CONFIRM_KEYS.mineReferencesEmpty,
    title: 'Mine references: nothing parsed',
    description:
      'Shown when reference mining finishes with zero candidates — typically because the body.md has no References section, or the formatting is too irregular for the first-pass extractor.',
  },
  {
    key: CONFIRM_KEYS.mineReferencesFailed,
    title: 'Mine references: error',
    description:
      'Shown when reference mining or stub creation fails outright (network error, LLM returned non-JSON, etc).',
  },
  {
    key: CONFIRM_KEYS.mineReferencesResult,
    title: 'Mine references: summary',
    description:
      'Shown after approved references are materialised, summarising how many became new stubs vs matched existing sources vs were skipped.',
  },
  {
    key: CONFIRM_KEYS.resolveStubEmpty,
    title: 'Resolve stub: no matches',
    description:
      'Shown when CrossRef returned no candidates for a stub-resolve search.',
  },
  {
    key: CONFIRM_KEYS.resolveStubFailed,
    title: 'Resolve stub: error',
    description:
      'Shown when stub resolution or apply step fails (network error, CrossRef 5xx, invalid response, …).',
  },
  {
    key: CONFIRM_KEYS.resolveStubApplied,
    title: 'Resolve stub: applied',
    description:
      'Shown after the chosen DOI is applied to a stub, confirming the new title and that existing citations to the old id still resolve.',
  },
  {
    key: CONFIRM_KEYS.createNoteFromConvEmpty,
    title: 'Create note from conversation: nothing to create',
    description:
      'Shown when "Create note" is triggered on a conversation that has no assistant text and no selection.',
  },
  {
    key: CONFIRM_KEYS.createNoteFromConvFailed,
    title: 'Create note from conversation: error',
    description:
      'Shown when the file write for a conversation-derived note fails (permissions, disk full, etc).',
  },
  {
    key: CONFIRM_KEYS.tableNameCollision,
    title: 'CSV: table name collision',
    description:
      'Shown when two CSVs derive the same DuckDB table name and the second is skipped. Add a `table_name:` line to a companion .md to disambiguate.',
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
    key: CONFIRM_KEYS.imageUploadFailed,
    title: 'Image upload rejected',
    description:
      'Shown when a drag-and-drop or paste image upload is rejected — too large (>5MB), unsupported MIME, empty blob, or write failure. Suppressing this won\'t silently swallow uploads; the editor still does nothing for unsupported drops, the user just stops getting the explanation.',
  },
  {
    key: CONFIRM_KEYS.pythonTrust,
    title: 'Compute trust prompt',
    description:
      'First-run prompt before any compute cell (Python, SQL, or SPARQL) executes in a new thoughtbase (#373, #1325). Trust is recorded per-project in `.minerva/config.json`, not per-machine — the dialog hides the Don\'t-ask-again checkbox, and this entry is here so the suppression UI lists the key for completeness but suppressing it has no effect.',
  },
  {
    key: CONFIRM_KEYS.exportComplete,
    title: 'Export complete',
    description:
      'Summary dialog after an export finishes (how many files were written and to which directory).',
  },
  {
    key: CONFIRM_KEYS.mergeNote,
    title: 'Merge note into…',
    description:
      'Pre-flight confirmation before merging the active note into another note (#464). Lists how many incoming wiki-links will be rewritten across how many files, since this rewrites multiple files in a single operation.',
  },
  {
    key: CONFIRM_KEYS.mergeFailed,
    title: 'Merge note failed',
    description:
      'Shown when "Merge note into…" errors out after the user confirmed — read failure, write failure mid-rewrite, etc. Recovery is `git reset --hard HEAD`.',
  },
  {
    key: CONFIRM_KEYS.mergeSourcesFailed,
    title: 'Merge sources failed',
    description:
      'Shown when the duplicate-source merge quick-fix (Inspections panel, #1446) fails to merge one of the duplicates into the kept source.',
  },
  {
    key: CONFIRM_KEYS.bibliographyResult,
    title: 'Bibliography updated',
    description:
      'Summary dialog after Insert/Update Bibliography finishes — entry count and any cited ids the renderer could not resolve.',
  },
  {
    key: CONFIRM_KEYS.bibliographyFailed,
    title: 'Bibliography failed',
    description:
      'Shown when Insert/Update Bibliography errors out (file read failure, citeproc engine error, etc).',
  },
  {
    key: CONFIRM_KEYS.missingApiKey,
    title: 'Anthropic API key not configured',
    description:
      'Shown when an LLM-backed action (conversation, auto-tag, auto-link, decompose, etc.) tries to run without an API key. The dialog hides Don’t-ask-again so the user can’t accidentally re-silence the very condition that blocks LLM features.',
  },
];

const byKey = new Map(CONFIRM_REGISTRY.map((e) => [e.key, e]));

export function confirmRegistryEntry(key: string): ConfirmRegistryEntry | null {
  return byKey.get(key as ConfirmKey) ?? null;
}
