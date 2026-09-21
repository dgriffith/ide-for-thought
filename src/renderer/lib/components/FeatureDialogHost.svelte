<script lang="ts">
  /**
   * Every modal, overlay and floating affordance the app can show, in one
   * place (#2236, epic #2241).
   *
   * This region lived at the bottom of App.svelte: ~270 lines of `{#if}` arms
   * plus the 27 component imports feeding them. `dialogs.svelte.ts` had already
   * taken the generic prompt/confirm primitives at #670 and recorded why the
   * rest stayed: "Feature-specific dialogs … close over feature handlers and
   * aren't general primitives." True of the mechanism available then; the
   * ops-bag pattern (#1922 / #2049, `Sidebar.svelte` as the worked example)
   * removed the constraint. Handlers arrive as one typed object, so the markup
   * no longer has to be defined where they are.
   *
   * ── Where each dialog's state comes from ───────────────────────────────────
   * Three sources, and the difference is worth seeing at a glance:
   *
   *   - **`featureDialogs`** — the ~19 flags App.svelte used to hold itself.
   *   - **Feature stores** (`sourceFlow`, `refactorFlow`, `linkDrag`, `busy`) —
   *     already store-backed before this change; read directly, never mirrored.
   *   - **`ops`** — the handlers. Not state: what to DO when a dialog resolves.
   *
   * ── Why some ops look like they should be inline ───────────────────────────
   * `onApplyFontSize`, `onThemeChanged`, `onGotoLine` and friends are thin
   * pass-throughs that could look like ceremony. They aren't: their bodies
   * reach into App's editor/preview/query-panel component instances and its
   * chrome state (font size, theme label, breadcrumb cache). That is
   * composition-root business — App.svelte owns those refs, per CLAUDE.md — so
   * the markup moves here and the logic stays there. Pulling the refs across
   * instead would just relocate the coupling.
   */
    import { getFeatureDialogStore } from '../stores/feature-dialogs.svelte';
  import { getSourceFlowStore } from '../stores/source-flow.svelte';
  import { getRefactorFlowStore } from '../stores/refactor-flow.svelte';
  import { getLinkDrag } from '../stores/link-drag.svelte';
  import { getBusyStore } from '../stores/busy.svelte';
  import { getNotebaseStore } from '../stores/notebase.svelte';
  import { getEditorStore } from '../stores/editor.svelte';
  import type { SourceMetadata, SavedQuery } from '../../../shared/types';
  import type { ParsedReference } from '../../../shared/mine-references';
  import type { AutoLinkSuggestion } from '../../../shared/refactor/auto-link';
  import type { AutoLinkInboundSuggestion } from '../../../shared/refactor/auto-link-inbound';
  import type { Command } from '../command-palette/types';
  import type { EditorSettings } from '../editor/settings';

  import DialogHost from './DialogHost.svelte';
  import MultiFileHistoryDialog from './MultiFileHistoryDialog.svelte';
  import DictationIndicator from './DictationIndicator.svelte';
  import Toasts from './Toasts.svelte';
  import BusyOverlay from './BusyOverlay.svelte';
  import AboutDialog from './AboutDialog.svelte';
  import ShortcutsDialog from './ShortcutsDialog.svelte';
  import SettingsDialog from './SettingsDialog.svelte';
  import OnboardingDialog from './OnboardingDialog.svelte';
  import ThoughtbaseProperties from './ThoughtbaseProperties.svelte';
  import CommandPaletteDialog from './CommandPaletteDialog.svelte';
  import GotoNoteDialog from './GotoNoteDialog.svelte';
  import GotoLineDialog from './GotoLineDialog.svelte';
  import FindInNotesDialog from './FindInNotesDialog.svelte';
  import EditSavedQueriesDialog from './EditSavedQueriesDialog.svelte';
  import EditSavedViewsDialog from './EditSavedViewsDialog.svelte';
  import SaveQueryDialog from './SaveQueryDialog.svelte';
  import AttachEvidenceDialog from './AttachEvidenceDialog.svelte';
  import TypeEditorDialog from './TypeEditorDialog.svelte';
  import ExportDialog from './ExportDialog.svelte';
  import PublishDialog from './PublishDialog.svelte';
  import SafeDeleteBlockerDialog from './SafeDeleteBlockerDialog.svelte';
  import MineReferencesDialog from './MineReferencesDialog.svelte';
  import ResolveStubDialog from './ResolveStubDialog.svelte';
  import AutoLinkDialog from './AutoLinkDialog.svelte';
  import AutoLinkInboundDialog from './AutoLinkInboundDialog.svelte';
  import AutoTagDialog from './AutoTagDialog.svelte';

  /**
   * The feature handlers these dialogs resolve into. One typed object rather
   * than ~25 individual props — the ops-bag shape CLAUDE.md documents, and the
   * reason this markup can live outside the component that owns the handlers.
   */
  export interface FeatureDialogOps {
    // Navigation / opening
    onFileSelect: (path: string) => void;
    onOpenSource: (id: string) => void;
    onOpenQuery: (query: string, language: 'sparql' | 'sql') => void;
    /** Jump the focused editor to a position; App owns the editor instance and
     *  the navigation-history record that goes with the jump. */
    onGotoLine: (line: number, column: number) => void;
    /** Current cursor position, for pre-filling the Goto Line dialog. */
    getCursorPosition: () => { line: number; column: number };

    // Feature completions
    onMerge: (source: string, target: string) => void;
    onAttachEvidence: (claimPath: string, role: 'grounds' | 'supports' | 'rebuts') => void;
    onTypeEditorSaved: (id: string) => void;
    onOcrDone: (pages: string[]) => void;
    onOcrCancel: () => void;
    onJumpToMatch: (relativePath: string, line: number, col: number) => void;
    onMineReferencesApply: (accepted: ParsedReference[]) => Promise<void>;
    onResolveStubApply: (doi: string) => Promise<void>;
    onAutoLinkApply: (accepted: AutoLinkSuggestion[]) => void;
    onAutoLinkInboundApply: (accepted: AutoLinkInboundSuggestion[]) => void;
    onAutoTagApply: (accepted: string[]) => void;
    onOpenFirstReference: (source: string, target: string) => void;
    onExported: (result: { summary: string; writtenPaths: string[] }) => void;

    // Onboarding
    onOnboardingAccept: (answers: unknown, dontAskAgain: boolean) => void;
    onOnboardingDecline: (dontAskAgain: boolean) => void;
    onOnboardingStartFromType: () => void;

    // Thoughtbase properties
    onSaveThoughtbaseProperties: (
      args: { name: string; baseUri?: string | undefined },
    ) => Promise<{ ok: true } | { ok: false; error: string }>;

    // Settings — bodies stay in App, which owns the component refs + chrome state
    onApplyEditorSettings: (settings: EditorSettings) => void;
    onApplyFontSize: (px: number) => void;
    onThemeChanged: () => void;
    onSettingsClosed: () => void;
  }

  interface Props {
    ops: FeatureDialogOps;
    /** Note/source/query pickers read these caches; App owns the refresh. */
    sources: SourceMetadata[];
    savedQueries: SavedQuery[];
    /** Built lazily by App, gated on the palette being open (#1108). */
    commands: Command[];
  }

  const { ops, sources, savedQueries, commands }: Props = $props();

  const featureDialogs = getFeatureDialogStore();
  const sourceFlow = getSourceFlowStore();
  const refactorFlow = getRefactorFlowStore();
  const linkDrag = getLinkDrag();
  const busy = getBusyStore();
  const notebase = getNotebaseStore();
  const editor = getEditorStore();
</script>

{#if featureDialogs.gotoNote}
  <GotoNoteDialog
    files={notebase.files}
    {sources}
    {savedQueries}
    onSelect={(path) => { featureDialogs.setGotoNote(false); ops.onFileSelect(path); }}
    onSelectSource={(id) => { featureDialogs.setGotoNote(false); ops.onOpenSource(id); }}
    onSelectQuery={(q) => { featureDialogs.setGotoNote(false); ops.onOpenQuery(q.query, q.language ?? 'sparql'); }}
    onCancel={() => { featureDialogs.setGotoNote(false); }}
  />
{/if}
{#if featureDialogs.mergePickerSource}
  <GotoNoteDialog
    files={notebase.files}
    placeholder="Merge into note..."
    excludePath={featureDialogs.mergePickerSource}
    onSelect={(path) => {
      const src = featureDialogs.mergePickerSource;
      featureDialogs.setMergePickerSource(null);
      if (src) ops.onMerge(src, path);
    }}
    onCancel={() => { featureDialogs.setMergePickerSource(null); }}
  />
{/if}
{#if featureDialogs.gotoLine}
  {@const pos = ops.getCursorPosition()}
  <GotoLineDialog
    currentLine={pos.line}
    currentColumn={pos.column}
    onGoto={(line, col) => { featureDialogs.setGotoLine(false); ops.onGotoLine(line, col); }}
    onCancel={() => { featureDialogs.setGotoLine(false); }}
  />
{/if}
{#if featureDialogs.editSavedQueries}
  <EditSavedQueriesDialog projectOpen={!!notebase.meta} onClose={() => { featureDialogs.setEditSavedQueries(false); }} />
{/if}
{#if featureDialogs.editSavedViews}
  <EditSavedViewsDialog onClose={() => { featureDialogs.setEditSavedViews(false); }} />
{/if}
{#if featureDialogs.attachEvidenceExcerptId}
  <AttachEvidenceDialog
    excerptId={featureDialogs.attachEvidenceExcerptId}
    onClose={() => { featureDialogs.setAttachEvidenceExcerptId(null); }}
    onAttach={ops.onAttachEvidence}
  />
{/if}
{#if featureDialogs.typeEditor}
  <TypeEditorDialog
    initial={featureDialogs.typeEditor.initial}
    onClose={() => { featureDialogs.setTypeEditor(null); }}
    onSaved={ops.onTypeEditorSaved}
  />
{/if}
{#if featureDialogs.saveQuery}
  <SaveQueryDialog
    projectOpen={!!notebase.meta}
    initialName={featureDialogs.saveQuery.initialName}
    initialScope={featureDialogs.saveQuery.initialScope}
    onConfirm={featureDialogs.saveQuery.onConfirm}
    onCancel={featureDialogs.saveQuery.onCancel}
  />
{/if}
{#if sourceFlow.ocrSession && sourceFlow.ocrPdfBytes}
  <!-- Lazy: tesseract.js (multi-MB WASM) + pdfjs only load when OCR actually
       runs, keeping them out of the eager startup graph (#691). -->
  {#await import('./OcrProgressDialog.svelte') then { default: OcrProgressDialog }}
    <OcrProgressDialog
      pdfBytes={sourceFlow.ocrPdfBytes}
      pageCount={sourceFlow.ocrSession.pageCount}
      title={sourceFlow.ocrSession.title}
      onDone={ops.onOcrDone}
      onCancel={ops.onOcrCancel}
    />
  {/await}
{/if}
{#if featureDialogs.findInNotes}
  <FindInNotesDialog
    initialMode={featureDialogs.findInNotes}
    onJumpTo={ops.onJumpToMatch}
    onClose={() => { featureDialogs.setFindInNotes(null); }}
  />
{/if}
<DialogHost />
<MultiFileHistoryDialog />

<!-- Drag-to-add-link overlays (#1129): a ghost chip following the pointer and
     a live insertion caret in the editor under it. Pointer-event driven, so
     reactivity stays live and these actually paint (unlike native HTML5 drag). -->
{#if linkDrag.dragging && linkDrag.ghost}
  <div class="link-drag-ghost" style:left="{linkDrag.ghost.x + 12}px" style:top="{linkDrag.ghost.y + 10}px">
    {linkDrag.dragging.label}
  </div>
{/if}
{#if linkDrag.dragging && linkDrag.caret}
  <div
    class="link-drop-caret"
    style:left="{linkDrag.caret.left}px"
    style:top="{linkDrag.caret.top}px"
    style:height="{Math.max(2, linkDrag.caret.bottom - linkDrag.caret.top)}px"
  ></div>
{/if}

{#if sourceFlow.mineReview}
  <MineReferencesDialog
    parentTitle={sourceFlow.mineReview.parentTitle}
    refs={sourceFlow.mineReview.refs}
    onApply={ops.onMineReferencesApply}
    onCancel={() => sourceFlow.setMineReview(null)}
  />
{/if}
{#if sourceFlow.resolveStub}
  <ResolveStubDialog
    stubTitle={sourceFlow.resolveStub.stubTitle}
    candidates={sourceFlow.resolveStub.candidates}
    onApply={ops.onResolveStubApply}
    onCancel={() => sourceFlow.setResolveStub(null)}
  />
{/if}
{#if featureDialogs.safeDelete}
  {@const st = featureDialogs.safeDelete}
  <SafeDeleteBlockerDialog
    selectionCount={st.selectionCount}
    targets={st.targets}
    blockers={st.blockers}
    onCancel={() => { featureDialogs.setSafeDelete(null); }}
    onDeleteAnyway={async () => {
      featureDialogs.setSafeDelete(null);
      await st.proceed();
    }}
    onOpenFirstReference={ops.onOpenFirstReference}
  />
{/if}
{#if featureDialogs.commandPalette}
  <CommandPaletteDialog
    {commands}
    onClose={() => { featureDialogs.setCommandPalette(false); }}
  />
{/if}
<DictationIndicator />
<Toasts />
{#if featureDialogs.about}
  <AboutDialog onClose={() => { featureDialogs.setAbout(false); }} />
{/if}
{#if featureDialogs.shortcuts}
  <ShortcutsDialog onClose={() => { featureDialogs.setShortcuts(false); }} />
{/if}
{#if featureDialogs.exportGroup}
  <ExportDialog
    group={featureDialogs.exportGroup}
    activeFilePath={editor.activeFilePath}
    activeSourceId={editor.activeSourceTab?.sourceId ?? null}
    onCancel={() => { featureDialogs.setExportGroup(null); }}
    onExported={(result) => {
      featureDialogs.setExportGroup(null);
      ops.onExported(result);
    }}
  />
{/if}
{#if featureDialogs.publish}
  <PublishDialog onClose={() => { featureDialogs.setPublish(false); }} />
{/if}
{#if refactorFlow.autoLinkReview}
  <AutoLinkDialog
    suggestions={refactorFlow.autoLinkReview.suggestions}
    activeNoteBody={refactorFlow.autoLinkReview.activeBody}
    onApply={ops.onAutoLinkApply}
    onCancel={() => refactorFlow.setAutoLinkReview(null)}
  />
{/if}
{#if refactorFlow.autoLinkInboundReview}
  <AutoLinkInboundDialog
    suggestions={refactorFlow.autoLinkInboundReview.suggestions}
    activeStem={refactorFlow.autoLinkInboundReview.relativePath.replace(/\.md$/i, '')}
    onApply={ops.onAutoLinkInboundApply}
    onCancel={() => refactorFlow.setAutoLinkInboundReview(null)}
  />
{/if}
{#if refactorFlow.autoTagReview}
  <AutoTagDialog
    tags={refactorFlow.autoTagReview.tags}
    relativePath={refactorFlow.autoTagReview.relativePath}
    onApply={ops.onAutoTagApply}
    onCancel={() => refactorFlow.setAutoTagReview(null)}
  />
{/if}
{#if busy.label}
  <BusyOverlay label={busy.label} />
{/if}
{#if featureDialogs.settings}
  <SettingsDialog
    onApplyEditor={ops.onApplyEditorSettings}
    onApplyFontSize={ops.onApplyFontSize}
    onThemeChanged={ops.onThemeChanged}
    onClose={() => { featureDialogs.closeSettings(); ops.onSettingsClosed(); }}
    initialTab={featureDialogs.settingsTab}
  />
{/if}
{#if featureDialogs.onboarding}
  <OnboardingDialog
    onAccept={ops.onOnboardingAccept}
    onDecline={ops.onOnboardingDecline}
    onStartFromType={() => { featureDialogs.setOnboarding(false); ops.onOnboardingStartFromType(); }}
  />
{/if}

{#if featureDialogs.thoughtbaseProperties}
  <ThoughtbaseProperties
    onSave={async ({ name, baseUri }) => {
      const r = await ops.onSaveThoughtbaseProperties({ name, baseUri });
      // Keep the dialog open on a refusal so it can show the error.
      if (r.ok) featureDialogs.setThoughtbaseProperties(false);
      return r;
    }}
    onCancel={() => { featureDialogs.setThoughtbaseProperties(false); }}
  />
{/if}

<style>
  /* Moved with the markup they style (#2236) — scoped styles have to travel
     with their elements. Tier tokens per `z-index-layering.test.ts`. */
  .link-drag-ghost {
    position: fixed;
    z-index: var(--z-drag);
    pointer-events: none;
    max-width: 260px;
    padding: 3px 8px;
    background: var(--bg-elev-2);
    border: 1px solid var(--accent);
    border-radius: 5px;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  /* The live insertion caret shown in the editor at the drop position. */
  .link-drop-caret {
    position: fixed;
    z-index: var(--z-drag);
    pointer-events: none;
    width: 2px;
    background: var(--accent);
  }
</style>
