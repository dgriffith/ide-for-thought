<script lang="ts">
  import TitleBar from './lib/components/TitleBar.svelte';
  import TabBar from './lib/components/TabBar.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Editor from './lib/components/Editor.svelte';
  import SplitContainer from './lib/components/SplitContainer.svelte';
  import { dropZoneFromFraction, splitForZone, type DropZone } from './lib/editor/drop-zone';
  import { collectGroupIds } from './lib/editor/layout-tree';
  import QueryPanel from './lib/components/QueryPanel.svelte';
  import NeighborhoodGraph from './lib/components/NeighborhoodGraph.svelte';
  import TypeView from './lib/components/TypeView.svelte';
  import RightSidebar from './lib/components/RightSidebar.svelte';
  import StatusBar from './lib/components/StatusBar.svelte';
  import BreadcrumbsBar from './lib/components/BreadcrumbsBar.svelte';
  import { getBreadcrumbsSettings, type BreadcrumbsSettings } from './lib/breadcrumbs/settings';
  import Icon from './lib/components/Icon.svelte';
  import type { CursorInfo } from './lib/components/Editor.svelte';
  import Preview from './lib/components/Preview.svelte';
  import SourceDetail from './lib/components/SourceDetail.svelte';
  import { onMount } from 'svelte';
  import { getNotebaseStore } from './lib/stores/notebase.svelte';
  import { getEditorStore, type TypeViewTab } from './lib/stores/editor.svelte';
  import { savedViewsStore } from './lib/stores/saved-views.svelte';
  import { getBusyStore } from './lib/stores/busy.svelte';
  import { getClipboardStore } from './lib/stores/clipboard.svelte';
  import { getSourceDataStore } from './lib/stores/source-data.svelte';
  import { getSourceFlowStore } from './lib/stores/source-flow.svelte';
  import { getRefactorFlowStore } from './lib/stores/refactor-flow.svelte';
  import { createNoteOps, type NoteOpsCtx } from './lib/app/note-ops';
  import { createSourceOps, type SourceOpsCtx } from './lib/app/source-ops';
  import { createNavView, type NavViewCtx } from './lib/app/nav-view';
  import { createRefactorOps, type RefactorOpsCtx } from './lib/app/refactor-ops.svelte';
  import { createTemplateOps, type TemplateOpsCtx } from './lib/app/template-ops';
  import { createConversationOps, type ConversationOpsCtx } from './lib/app/conversation-ops';
  import { createProjectOps, type ProjectOpsCtx } from './lib/app/project-ops';
  import { registerAppIpc, type IpcWiringCtx } from './lib/app/ipc-wiring';
  import DialogHost from './lib/components/DialogHost.svelte';
  import { getDialogStore } from './lib/stores/dialogs.svelte';
  import { getLinkDrag } from './lib/stores/link-drag.svelte';
  // PdfViewer + OcrProgressDialog are loaded lazily at their render sites
  // (`{#await import()}`) so pdfjs-dist + tesseract.js stay out of the eager
  // startup graph (#691).
  import MineReferencesDialog from './lib/components/MineReferencesDialog.svelte';
  import ResolveStubDialog from './lib/components/ResolveStubDialog.svelte';
  import SafeDeleteBlockerDialog from './lib/components/SafeDeleteBlockerDialog.svelte';
  import type { SafeDeleteBlocker, MenuEditorState, SavedView, InspectionFix } from '../shared/types';
  import CommandPaletteDialog from './lib/components/CommandPaletteDialog.svelte';
  import type { Command } from './lib/command-palette/types';
  import { buildCommandRegistry } from './lib/command-palette/registry';
  import { createCommandKeymap, type CommandKeymapCtx } from './lib/app/command-keymap';
  import { formatAccelerator } from './lib/command-palette/format-accelerator';
  import DictationIndicator from './lib/components/DictationIndicator.svelte';
  import { toggleEditorDictation } from './lib/editor/dictation';
  import { getVoiceStore } from './lib/voice/voice.svelte';
  import { handleKeydown } from './lib/keymap/handle-keydown';
  import ExportDialog from './lib/components/ExportDialog.svelte';
  import PublishDialog from './lib/components/PublishDialog.svelte';
  import AboutDialog from './lib/components/AboutDialog.svelte';
  import ShortcutsDialog from './lib/components/ShortcutsDialog.svelte';
  import GotoLineDialog from './lib/components/GotoLineDialog.svelte';
  import EditSavedQueriesDialog from './lib/components/EditSavedQueriesDialog.svelte';
  import EditSavedViewsDialog from './lib/components/EditSavedViewsDialog.svelte';
  import AttachEvidenceDialog from './lib/components/AttachEvidenceDialog.svelte';
  import TypeEditorDialog from './lib/components/TypeEditorDialog.svelte';
  import type { TypeEditorInitial } from './lib/components/type-editor-value';
  import { setFrontmatterProperty } from '../shared/frontmatter-edit';
  import SaveQueryDialog from './lib/components/SaveQueryDialog.svelte';
  import FindInNotesDialog from './lib/components/FindInNotesDialog.svelte';
  import GotoNoteDialog from './lib/components/GotoNoteDialog.svelte';
  import ToolPanel from './lib/components/ToolPanel.svelte';
  import ConversationsPanel from './lib/components/ConversationsPanel.svelte';
  import AutoLinkDialog from './lib/components/AutoLinkDialog.svelte';
  import AutoTagDialog from './lib/components/AutoTagDialog.svelte';
  import AutoLinkInboundDialog from './lib/components/AutoLinkInboundDialog.svelte';
  import BusyOverlay from './lib/components/BusyOverlay.svelte';
  import CsvTable from './lib/components/CsvTable.svelte';
  import SettingsDialog from './lib/components/SettingsDialog.svelte';
  import OnboardingDialog from './lib/components/OnboardingDialog.svelte';
  import ThoughtbaseProperties from './lib/components/ThoughtbaseProperties.svelte';
  import { api } from './lib/ipc/client';
  import { getNavigationStore } from './lib/stores/navigation.svelte';
  import { initTheme, cycleTheme, getThemeMode, setThemeMode, type ThemeMode } from './lib/theme';
  import { getEditorSettings, saveEditorSettings } from './lib/editor/settings';
  import {
    flattenNotePaths,
    lineBookmarkName,
    formatCappedList,
  } from './lib/app/text-helpers';
  import { noteTargetPathBeside } from '../shared/wiki-link-resolver';
  import { initAppearance } from './lib/appearance/settings';
  import { applyStoredZoom } from './lib/appearance/zoom';
  import { clampFontSize } from './lib/editor/font-size';
  import { getConversationsStore } from './lib/stores/conversations.svelte';
  import { getBookmarksStore, collectBookmarksForPath } from './lib/stores/bookmarks.svelte';
  import { getProposalsStore } from './lib/stores/proposals.svelte';
  import { savedQueriesStore } from './lib/stores/saved-queries.svelte';
  import { getToastStore } from './lib/stores/toasts.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import { describeProposer } from '../shared/provenance';
  import { CONFIRM_KEYS } from './lib/confirm-keys';
  import { sectionAnchorAt } from './lib/markdown/headings';
  import { isProviderUnconfiguredError, unconfiguredProvider } from '../shared/llm-errors';
  import { PROVIDERS } from '../shared/tools/providers';
  import { runCellWithTrust } from './lib/compute/run-cell-with-trust';
  import { findRunnableFences, RUNNABLE_LANGUAGE_SET } from '../shared/compute/fences';
  import { toggleTaskOnLine } from './lib/editor/task-toggle';


  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const busy = getBusyStore();
  const sourceFlow = getSourceFlowStore();
  const refactorFlow = getRefactorFlowStore();
  const clipboard = getClipboardStore();
  /** Last note tab the user was on. Used by the SourceDetail "Append
   *  to current note" action (#101) — when the user is viewing a
   *  source-detail tab the active tab IS the source, so "current"
   *  means the previously-active note tab. Tracked here rather than
   *  in the editor store because nothing else cares about it. */
  let lastNotePath = $state<string | null>(null);
  $effect(() => {
    const t = editor.activeNoteTab;
    if (t) lastNotePath = t.relativePath;
  });
  const nav = getNavigationStore();
  const conversationsStore = getConversationsStore();
  const bookmarkStore = getBookmarksStore();
  // Pending-proposals count drives the status-bar badge (#1528); the store also
  // powers the left Proposals panel and self-updates on out-of-process changes.
  const proposalsStore = getProposalsStore();
  const toasts = getToastStore();
  const voice = getVoiceStore();

  /** Open the left Proposals panel — shared by the status-bar badge, the arrival
   *  toast, and the native-notification click (#1528/#1541). */
  function openProposals() {
    sidebarVisible = true;
    sidebar?.showPanel('proposals');
  }

  /**
   * A batch of newly-pending proposals arrived (#1541). When Minerva is focused,
   * show an in-app toast; when it isn't, ask main to raise a native OS
   * notification instead — never both for the same arrival. Provenance comes
   * from `describeProposer`; a single shared proposer is named, a mixed batch
   * just shows the count.
   */
  function handleProposalArrival(arrived: { proposedBy: string }[]) {
    const count = arrived.length;
    if (count === 0) return;
    const proposers = new Set(arrived.map((p) => p.proposedBy));
    const who = proposers.size === 1 ? describeProposer([...proposers][0]).label : '';
    const from = who ? ` from ${who}` : '';
    const message = count === 1 ? `New proposal${from}` : `${count} new proposals${from}`;
    if (document.hasFocus()) {
      toasts.push({ message, onClick: openProposals });
    } else {
      void api.proposals.notifyArrival({ count, proposer: who });
    }
  }
  // Position-bearing bookmarks are resolved per pane at the Editor mount via
  // `collectBookmarksForPath(bookmarkStore.tree, <that pane's file>)` (#813),
  // so each split pane shows its own file's gutter flags (#756).
  let showSettings = $state(false);
  /** Tab the SettingsDialog should land on when next opened. Cleared
   *  on close so the next manual open returns to the default Editor
   *  tab. Set by `handleMissingApiKey` to jump straight to the AI tab
   *  where the API key field lives. */
  let settingsInitialTab = $state<'ai' | undefined>(undefined);
  /** Onboarding modal visibility. Triggered by onProjectOpened when
   *  the thoughtbase has zero notes AND its per-project
   *  `onboarding.dismissed` flag is false. */
  let showOnboarding = $state(false);
  /** Thoughtbase Properties dialog visibility (#1443), opened from File → Thoughtbase Properties…. */
  let showThoughtbaseProperties = $state(false);

  // The Inspections panel is re-enabled (#1446), but the status-bar count
  // badge is still un-polled — inspectionCount stays 0 so the badge stays
  // hidden. See the deferred polling note in the project-open handler.
  let inspectionCount = $state(0);
  let backlinkCount = $state(0);
  /** Semantic-index backfill progress, or null when idle (#836). */
  let embeddingProgress = $state<{ done: number; total: number } | null>(null);
  /** Frontmatter alias → relativePath snapshot (#469). Refreshed on
   *  graph changes so wiki-link nav resolves new aliases without a
   *  full project reload. */
  let aliasMap = $state<Record<string, string>>({});
  /** Same data as `aliasMap` but in entries form with original casing,
   *  so the editor's `[[…]]` autocomplete can suggest `JFK` (not
   *  `jfk`) when the user types `[[jf` (#492). Refreshed in lockstep. */
  let aliasEntries = $state<Array<{ alias: string; relativePath: string }>>([]);

  async function refreshAliasMap() {
    if (!notebase.meta) return;
    try {
      aliasMap = await api.graph.aliasMap();
    } catch {
      aliasMap = {};
    }
    try {
      aliasEntries = await api.graph.aliasEntries();
    } catch {
      aliasEntries = [];
    }
  }

  /**
   * Refetch the backlink count for the active note (#472). Cheap IPC,
   * called on tab switch and after auto-saves; not polled.
   */
  async function refreshBacklinkCount() {
    const path = editor.activeFilePath;
    if (!path) {
      backlinkCount = 0;
      return;
    }
    try {
      const links = await api.links.backlinks(path);
      // Guard against a tab switch racing the in-flight fetch.
      if (editor.activeFilePath === path) {
        backlinkCount = links.length;
      }
    } catch {
      backlinkCount = 0;
    }
  }

  $effect(() => {
    // React to tab/file switches. Reading `editor.activeFilePath` here
    // tracks it as a reactive dependency so this re-runs on every
    // change without needing a manual onTabChange hook.
    void editor.activeFilePath;
    void refreshBacklinkCount();
  });

  // Surface the missing-API-key dialog whenever the conversations
  // store flags it. The store flips the flag from its send() catch
  // block on `isProviderUnconfiguredError`; we read the flag here (which makes
  // it a reactive dep), show the modal, then call dismiss so a follow-up
  // failure can re-fire the dialog.
  $effect(() => {
    if (conversationsStore.needsApiKey) {
      conversationsStore.dismissApiKeyDialog();
      void handleMissingApiKey();
    }
  });

  // ConversationsPanel handles its own per-project init via onMount,
  // remounting on project change via the {#key} block at the mount site.
  // viewMode now lives per editor group in the editor store (#811) — read it
  // via `editor.viewMode` and set it via `editor.setViewMode`.
  let sidebarVisible = $state(true);
  let sidebar = $state<Sidebar>();
  let rightSidebar = $state<RightSidebar>();
  let rightSidebarVisible = $state(false);
  // Per-group component instances, keyed by group id (#813). Each split pane
  // binds its own Editor / Preview / QueryPanel into these maps; the bare
  // `editorComponent` / `previewComponent` / `queryPanelComponent` accessors
  // resolve to the *active* group's instance so all the imperative command
  // sites (nav, goto-line, insert, theme re-skin) target the focused pane.
  let editorComponents = $state<Record<string, Editor | undefined>>({});
  let queryPanelComponents = $state<Record<string, QueryPanel | undefined>>({});
  let neighborhoodGraphComponents = $state<Record<string, NeighborhoodGraph | undefined>>({});
  let previewComponents = $state<Record<string, Preview | undefined>>({});
  // Bumped on save / auto-save so an open neighborhood graph re-fetches when
  // links change (#847 live-update).
  let graphRevision = $state(0);
  const editorComponent = $derived(editorComponents[editor.activeGroupId]);
  const queryPanelComponent = $derived(queryPanelComponents[editor.activeGroupId]);
  const neighborhoodGraphComponent = $derived(neighborhoodGraphComponents[editor.activeGroupId]);
  const previewComponent = $derived(previewComponents[editor.activeGroupId]);
  let toolPanelComponent = $state<ToolPanel>();
  let cursorInfo = $state<CursorInfo>({ line: 1, column: 1, selectionLength: 0, wordCount: 0 });

  // Report note/selection state to main so the native menu can gray out
  // note/selection-only items (the command palette already gates reactively;
  // the native menu had no such signal). `cursorInfo` follows the focused pane's
  // editor, so it doubles as the selection source. Report only on boolean flip —
  // cursor moves and selection-length changes that don't cross empty↔non-empty
  // send nothing, so the native menu isn't rebuilt on every keystroke. Main
  // dedupes again as a backstop.
  let lastEditorStateReport: MenuEditorState | null = null;
  $effect(() => {
    const hasEditor = !!editor.activeTab;
    const hasNote = editor.activeTab?.type === 'note';
    const hasSelection = hasNote && cursorInfo.selectionLength > 0;
    if (
      lastEditorStateReport?.hasEditor === hasEditor &&
      lastEditorStateReport?.hasNote === hasNote &&
      lastEditorStateReport?.hasSelection === hasSelection
    ) return;
    lastEditorStateReport = { hasEditor, hasNote, hasSelection };
    api.menu.reportEditorState(lastEditorStateReport);
  });

  // Drag-tab-to-split (#817) — pointer-based, NOT HTML5 DnD. A macOS native
  // drag enters a nested run-loop that suspends the page's reactivity queue, so
  // an overlay created reactively on dragstart never renders and the drop never
  // lands. Pointer events keep reactivity live, so the preview + drop both work
  // (and it's deterministically testable).
  //
  // `draggingTab` is the tab being dragged once movement passes the threshold;
  // `dropTarget` is the pane + zone currently under the pointer (drives the
  // preview). `pendingDrag` is the pre-threshold press (plain, non-reactive).
  let draggingTab = $state<{ groupId: string; index: number } | null>(null);
  let dropTarget = $state<{ groupId: string; zone: DropZone } | null>(null);
  let pendingDrag: { groupId: string; index: number; startX: number; startY: number } | null = null;
  const DRAG_THRESHOLD = 5; // px before a press becomes a drag

  // Suppress text selection / show a grabbing cursor while a tab drags.
  $effect(() => {
    document.body.classList.toggle('tab-dragging', draggingTab !== null);
  });

  /** Other editor groups a tab in `groupId` can be moved to (#870), in visual
   *  (left-to-right) order and labelled by position. Empty when single-pane. */
  function otherGroupsFor(groupId: string): { id: string; label: string }[] {
    return collectGroupIds(editor.layout)
      .map((id, i) => ({ id, label: `Group ${i + 1}` }))
      .filter((g) => g.id !== groupId);
  }

  function onTabPointerDown(groupId: string, index: number, e: PointerEvent) {
    pendingDrag = { groupId, index, startX: e.clientX, startY: e.clientY };
    window.addEventListener('pointermove', onTabPointerMove);
    window.addEventListener('pointerup', onTabPointerUp, { once: true });
  }

  function onTabPointerMove(e: PointerEvent) {
    if (!pendingDrag) return;
    if (!draggingTab) {
      if (Math.hypot(e.clientX - pendingDrag.startX, e.clientY - pendingDrag.startY) < DRAG_THRESHOLD) return;
      draggingTab = { groupId: pendingDrag.groupId, index: pendingDrag.index };
    }
    dropTarget = dropTargetAt(e.clientX, e.clientY);
  }

  /** Which pane + zone the pointer is over, via the pane's data-group-id and
   *  geometry. Returns null when the pointer isn't over a pane. */
  function dropTargetAt(x: number, y: number): { groupId: string; zone: DropZone } | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const pane = el?.closest<HTMLElement>('.group-pane');
    const groupId = pane?.dataset.groupId;
    if (!pane || !groupId) return null;
    // Over a pane's tab bar → "move into this group" (the natural gesture),
    // not a split — matches VS Code (#817). The geometric top strip would
    // otherwise read as a split-down.
    if (el?.closest('.tab-bar')) return { groupId, zone: 'center' };
    const r = pane.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { groupId, zone: dropZoneFromFraction((x - r.left) / r.width, (y - r.top) / r.height) };
  }

  function onTabPointerUp() {
    window.removeEventListener('pointermove', onTabPointerMove);
    const drag = draggingTab;
    const target = dropTarget;
    pendingDrag = null;
    draggingTab = null;
    dropTarget = null;
    if (!drag || !target) return;
    const split = splitForZone(target.zone);
    if (!split) {
      if (drag.groupId === target.groupId) return; // center of its own pane → no-op
      editor.moveTab(drag.groupId, drag.index, target.groupId);
    } else {
      editor.moveTabToSplit(drag.groupId, drag.index, target.groupId, split.direction, split.before);
    }
  }

  // Breadcrumbs bar above the editor (#476). Single toggle for the
  // heading-chain second tier — held in local state so the bar reacts
  // immediately when the user flips it from Settings (the dialog calls
  // setBreadcrumbsSettings, then notifies via the same patch we keep here).
  let breadcrumbsSettings = $state<BreadcrumbsSettings>({ ...getBreadcrumbsSettings() });
  // Cache of every indexed source, refreshed on `sources:changed` and on
  // project open. Feeds the Editor's `[[cite::…]]` autocomplete so typing
  // in the editor doesn't have to await an IPC round-trip per keystroke.
  let sourcesCache = $state<import('../shared/types').SourceMetadata[]>([]);
  async function refreshSourcesCache(): Promise<void> {
    try { sourcesCache = await api.sources.listAll(); } catch { /* ignore */ }
  }
  /** Lazy cache of saved queries — populated when the Goto palette
   *  opens so its Queries scope chip has live counts without paying
   *  the IPC cost on every keystroke. */
  let savedQueriesCache = $state<import('../shared/types').SavedQuery[]>([]);
  async function refreshSavedQueriesCache(): Promise<void> {
    try { savedQueriesCache = await api.queries.list(); } catch { /* ignore */ }
  }
  let editorFontSize = $state(parseInt(localStorage.getItem('editorFontSize') ?? '14', 10));
  let themeLabel = $state(getThemeMode());
  // §-numeral heading setting (#1120), mirrored reactively so every Preview
  // re-skins the moment it's toggled in Settings → Editor.
  let numberedHeadings = $state(getEditorSettings().numberedHeadings);
  // Generic modal dialogs (prompt / confirm / new-note / snippet / open-target)
  // live in the dialog store (#670); destructure the imperative `show*` helpers
  // so the many call sites read unchanged. <DialogHost> renders the state.
  const dialogs = getDialogStore();
  const linkDrag = getLinkDrag();
  const { showPrompt, showConfirm, showComputeConsent } = dialogs;

  let showEditSavedViews = $state(false);

  // Type editor (#1585) opened from "Save Note as Object Type" — pre-filled from
  // the note; on save the note is promoted to the new type (its first instance).
  let typeEditorState = $state<{ initial: TypeEditorInitial; promoteNotePath: string } | null>(null);
  function handleTypeEditorSaved(id: string): void {
    const s = typeEditorState;
    typeEditorState = null;
    if (s && editor.activeFilePath === s.promoteNotePath) {
      editor.setContent(setFrontmatterProperty(editor.content, 'type', id));
    }
    sidebar?.refreshObjects();
  }

  // Attach-excerpt-as-evidence (#1073): the excerpt whose evidence dialog is open.
  let attachEvidenceExcerptId = $state<string | null>(null);
  async function handleAttachEvidence(claimPath: string, role: 'grounds' | 'supports' | 'rebuts'): Promise<void> {
    const excerptId = attachEvidenceExcerptId;
    attachEvidenceExcerptId = null;
    if (!excerptId) return;
    // The store files it and re-lists itself; App keeps the dialog and the toast.
    const res = await proposalsStore.attachExcerptEvidence(excerptId, claimPath, role);
    if (res.ok) {
      toasts.push({ message: `Evidence proposal filed — review it in Proposals`, onClick: openProposals });
    } else {
      toasts.push({ message: `Could not attach evidence: ${res.error ?? 'unknown error'}` });
    }
  }

  // Open a saved view (#1072): its exact projection — mode, sort, columns —
  // re-applied onto (or opening) the type's multi-view tab.
  function handleOpenSavedView(view: SavedView): void {
    editor.openTypeView(view.typeId, {
      layout: view.layout,
      sortColumn: view.sortColumn,
      sortDir: view.sortDir,
      columns: view.columns,
    });
  }

  // Save the active type-view's projection as a named view (#1072). Defaults to
  // project scope so the preset travels with the thoughtbase.
  async function handleSaveView(tab: TypeViewTab): Promise<void> {
    const name = await showPrompt('Save view as:');
    if (!name) return;
    await savedViewsStore.save('project', {
      name,
      typeId: tab.typeId,
      layout: tab.layout,
      sortColumn: tab.sortColumn,
      sortDir: tab.sortDir,
      columns: tab.columns,
    });
  }
  // The format-family group id the Export menu launched with (#: export-menu-redesign).
  let exportDialogGroup = $state<string | null>(null);
  let publishDialogOpen = $state(false);
  let showAbout = $state(false);
  let showShortcuts = $state(false);

  /**
   * Bookmark the section the cursor sits in — the nearest heading at/above
   * it. Stores the heading slug as the bookmark's `anchor` so opening it
   * scrolls to that heading (#755). Falls back to a dismissible notice when
   * the cursor is above the note's first heading.
   */
  async function handleBookmarkSection() {
    if (!editor.activeFilePath) return;
    const offset = editorComponent?.getOffset() ?? 0;
    const section = sectionAnchorAt(editor.content, offset);
    if (!section) {
      await showConfirm(
        'No section heading above the cursor to bookmark. Place the cursor inside a section first.',
        CONFIRM_KEYS.bookmarkSectionNoHeading,
        'OK',
      );
      return;
    }
    bookmarkStore.add(section.text, editor.activeFilePath, { anchor: section.slug });
  }

  /**
   * Bookmark the current line — stores the cursor offset so opening jumps
   * back to it (#756, offset MVP). The offset can go stale if text above is
   * later edited. A line bookmark is one with a `cursorOffset` and no
   * `anchor`; the panels render it distinctly and open it via the offset.
   */
  function handleBookmarkLine() {
    if (!editor.activeFilePath) return;
    const offset = editorComponent?.getOffset() ?? 0;
    const name = lineBookmarkName(editor.content, offset);
    bookmarkStore.add(name, editor.activeFilePath, { cursorOffset: offset });
  }

  /**
   * Surfaced when any LLM-backed action fails because the user hasn't
   * configured an Anthropic API key. Replaces the previous behavior —
   * a console.error in the conversations panel, or a generic
   * "<feature> failed: …" confirm in auto-link/auto-tag — with an
   * actionable dialog that opens the Settings dialog on the AI tab.
   *
   * Idempotent: if a dialog is already open the second call is a no-op
   * (showConfirm replaces the in-flight dialog, but we don't want
   * cascading prompts when several LLM actions fail in quick succession).
   * The dialog hides Don't-ask-again so muting it can't return us to the
   * previous silent-failure state.
   */
  let missingApiKeyPromptShown = false;
  /** Convenience for try/catch blocks around LLM-backed actions: if the
   *  caught error is a missing-API-key, show the actionable dialog and
   *  return true so the caller can skip its generic "X failed: …"
   *  confirm. Returns false for any other error so the caller's
   *  existing error path runs untouched. */
  async function maybeHandleMissingApiKey(err: unknown): Promise<boolean> {
    if (!isProviderUnconfiguredError(err)) return false;
    await handleMissingApiKey(err);
    return true;
  }
  /**
   * `err` is optional because one caller (the conversations store) signals
   * through a flag rather than handing the error over. Without it we say
   * something true-but-general — better than naming a provider we'd only be
   * guessing at, which is the bug this replaced (#1796 follow-up).
   */
  async function handleMissingApiKey(err?: unknown): Promise<void> {
    if (missingApiKeyPromptShown) return;
    missingApiKeyPromptShown = true;
    try {
      const provider = err === undefined ? null : unconfiguredProvider(err);
      const meta = provider ? PROVIDERS[provider] : null;
      const what = meta && !meta.requiresKey ? 'a base URL' : 'an API key';
      const envHint = meta?.envVar ? ` You can also set the ${meta.envVar} environment variable.` : '';
      const message = meta
        ? `This conversation is set to use ${meta.label}, which isn’t set up yet. ` +
          `Open Settings → AI to add ${what}.${envHint}`
        : 'The model this action uses isn’t set up yet. Open Settings → AI to add an API key ' +
          'for the service you want to use.';
      const ok = await showConfirm(
        message,
        CONFIRM_KEYS.missingApiKey,
        'Open Settings',
        { hideDontAskAgain: true },
      );
      if (ok) {
        settingsInitialTab = 'ai';
        showSettings = true;
      }
    } finally {
      missingApiKeyPromptShown = false;
    }
  }

  let pendingSearchQuery = $state<string | null>(null);
  let showGotoLine = $state(false);
  let showGotoNote = $state(false);
  let showCommandPalette = $state(false);

  /** Command-palette registry (#463). Re-derived whenever the host
   *  state the commands depend on (`enabled`) changes, so the
   *  palette never offers an action that would silently no-op.
   *
   *  Adding a command: append a row here. The palette and (later)
   *  custom keybinding UI both draw from this list. The Electron
   *  menu still lives in `src/main/menu.ts` — moving menus to read
   *  from this registry is a separate follow-up.
   *
   *  Gated on `showCommandPalette` (#1108): building the registry
   *  evaluates each command's `enabled` getter (`hasProject`,
   *  `hasNote`, …), which reads reactive editor/notebase state. If the
   *  `$derived` tracked those unconditionally it would rebuild all ~60
   *  objects on every note switch and navigation even with the palette
   *  closed — pure churn nobody consumes. Only the getter is reactive,
   *  so while the palette is closed the derived depends solely on
   *  `showCommandPalette` and navigation no longer touches it.
   */
  // The command-palette + global-keymap dependency tables live in
  // ./lib/app/command-keymap.ts (#1084). The factory pulls the stores itself
  // (predicates, active-note guards, close-project, font dance) and takes the
  // App-local ops handlers + focused-pane editor ref + UI-chrome $state via ctx.
  // Both tables are fully typed, so a mis-wired binding is a compile error.
  const { commandDeps, keymapDeps } = createCommandKeymap({
    getEditorComponent: () => editorComponent,
    newNote: () => { void handleNewNote(); },
    save: () => { void handleSave(); },
    openProject: () => { void handleOpenThoughtbase(); },
    newProject: () => { void handleNewThoughtbase(); },
    editThoughtbaseGuide: () => { void handleEditThoughtbaseDoc(); },
    saveAsTemplate: () => { void handleSaveAsTemplate(); },
    insertTemplate: () => { void handleInsertTemplate(); },
    extractSelection: () => { void handleExtractSelection(); },
    splitHere: () => { void handleSplitHere(); },
    splitByHeading: () => { void handleSplitByHeading(); },
    format: () => { void handleFormat(); },
    bibliography: () => { void handleBibliography(); },
    newConversation: () => { void newConversation(); },
    openConversation: () => { void openConversation(); },
    ingestUrl: () => { void handleIngestUrlAsSource(); },
    ingestIdentifier: () => { void handleIngestIdentifier(); },
    ingestFile: () => { void handleIngestFileAsSource(); },
    importBibtex: () => { void handleImportBibtex(); },
    importZoteroRdf: () => { void handleImportZoteroRdf(); },
    navBack: () => { void handleNavBack(); },
    navForward: () => { void handleNavForward(); },
    rename: (p) => { void handleRename(p); },
    move: (p) => { void handleMoveWithPrompt(p); },
    copy: (p) => { void handleCopyWithPrompt(p); },
    autoTag: (p) => { void handleAutoTag(p); },
    promoteToType: () => { void handlePromoteToType(); },
    saveNoteAsObjectType: () => { void handleSaveNoteAsObjectType(); },
    autoLink: (p) => { void handleAutoLink(p); },
    autoLinkInbound: (p) => { void handleAutoLinkInbound(p); },
    decompose: (p) => { void handleDecompose(p); },
    selectTheme: (mode) => handleSelectTheme(mode),
    cycleTheme: () => handleCycleTheme(),
    getThemeLabel: () => themeLabel,
    cycleViewMode: () => cycleViewMode(),
    refreshSourcesCache: () => { void refreshSourcesCache(); },
    refreshSavedQueriesCache: () => { void refreshSavedQueriesCache(); },
    getEditorFontSize: () => editorFontSize,
    setEditorFontSize: (n) => { editorFontSize = n; },
    setFindInNotesMode: (mode) => { findInNotesMode = mode; },
    setShowGotoLine: (v) => { showGotoLine = v; },
    setShowGotoNote: (v) => { showGotoNote = v; },
    toggleQuickOpen: () => { showGotoNote = !showGotoNote; },
    setShowEditSavedQueries: (v) => { showEditSavedQueries = v; },
    setShowSettings: (v) => { showSettings = v; },
    toggleSidebar: () => { sidebarVisible = !sidebarVisible; },
    toggleRightSidebar: () => { rightSidebarVisible = !rightSidebarVisible; },
    toggleCommandPalette: () => { showCommandPalette = !showCommandPalette; },
  } satisfies CommandKeymapCtx);
  const commands = $derived<Command[]>(
    showCommandPalette ? buildCommandRegistry(commandDeps) : [],
  );
  /** When non-null, the merge-target picker is shown. Holds the source
   *  note path; the picker filters the source out of its candidates. */
  let mergePickerSource = $state<string | null>(null);
  let showEditSavedQueries = $state(false);
  /** When non-null, the SaveQueryDialog is open with this initial state. */
  let saveQueryRequest = $state<{
    initialName: string;
    initialScope: 'project' | 'global';
    onConfirm: (args: { name: string; scope: 'project' | 'global' }) => void;
    onCancel: () => void;
  } | null>(null);
  let findInNotesMode = $state<'find' | 'replace' | null>(null);

  let pendingPreviewAnchor = $state<string | null>(null);

  /** Flatten the sidebar file tree to a list of indexable relative paths. */
  function handleTagSelect(tag: string) {
    sidebar?.refreshTags();
    setTimeout(() => sidebar?.selectTag(tag), 50);
  }

  function handleTaskToggle(lineIndex: number) {
    const current = editor.content;
    const next = toggleTaskOnLine(current, lineIndex);
    if (next !== current) editor.setContent(next);
  }

  async function handleSave() {
    if (editor.activeTab?.type === 'query') {
      await handleSaveQuery();
      return;
    }
    editor.flushAutoSave(); // cancel pending auto-save, save immediately
    sidebar?.refreshTags();
    sidebar?.refreshObjects();
    rightSidebar?.refresh();
    graphRevision++;
    void refreshBacklinkCount();
    void refreshAliasMap();
  }

  async function handleSaveQuery() {
    const tab = editor.activeQueryTab;
    if (!tab) return;
    const result = await new Promise<{ name: string; scope: 'project' | 'global' } | null>((resolve) => {
      saveQueryRequest = {
        initialName: tab.title === 'Query' ? '' : tab.title,
        initialScope: notebase.meta ? 'project' : 'global',
        onConfirm: (args) => { saveQueryRequest = null; resolve(args); },
        onCancel: () => { saveQueryRequest = null; resolve(null); },
      };
    });
    if (!result) return;
    await savedQueriesStore.save(result.scope, result.name, '', tab.query, tab.language);
    tab.title = result.name;
  }

  /**
   * Safe-delete blocker dialog state (#429). `proceed` is the
   * "Delete anyway" closure — calling it runs the existing batch
   * delete against the same `targets` snapshot the dialog was
   * computed from. Cleared when the user picks any of the three
   * exits or the dialog is dismissed.
   */
  let safeDeleteDialogState = $state<{
    selectionCount: number;
    targets: string[];
    blockers: SafeDeleteBlocker[];
    proceed: () => void | Promise<void>;
  } | null>(null);

  // Note-ops handler cluster (#670): new note / folder, delete (+ safe-delete),
  // the multi-path clipboard, merge, rename, prompt-driven copy / move. Lives in
  // ./lib/app/note-ops.ts; destructured into the same names so every call site
  // (menus, sidebar callbacks, command palette) reads unchanged. Placed after
  // the component refs + safeDelete/mergePicker state it closes over via getters.
  const noteOpsCtx: NoteOpsCtx = {
    getSidebar: () => sidebar,
    getEditorComponent: () => editorComponent,
    setSafeDeleteState: (s) => { safeDeleteDialogState = s; },
    setMergePickerSource: (s) => { mergePickerSource = s; },
    openTypeFields: () => { rightSidebarVisible = true; rightSidebar?.showPanel('properties'); },
    openTypeEditor: (initial, promoteNotePath) => { typeEditorState = { initial, promoteNotePath }; },
  };
  const {
    handleNewNote, createNoteFromReference, removeBrokenAnchor, handleInlineTypeCreate, handlePromoteToType, handleSaveNoteAsObjectType, handleNewFolder, handleDelete, openFirstReferenceFromSafeDelete,
    handleCut, handleCopy, handleMove, handlePaste, handleMerge, performMerge,
    handleRename, handleCopyWithPrompt, handleMoveWithPrompt,
  } = createNoteOps(noteOpsCtx);

  /** Apply an inspection's deterministic quick-fix (#1446). Maps the fix kind
   *  to its store / ops handler (the mutation never lives in the panel);
   *  conversation is only the panel's fallback for inspections with no fix. The
   *  returned promise lets the panel re-run the checks once the fix has applied.
   */
  async function applyInspectionFix(fix: InspectionFix): Promise<void> {
    switch (fix.kind) {
      case 'create-note':
        await createNoteFromReference(fix.targetPath);
        break;
      case 'set-read-status':
        await getSourceDataStore().setReadStatus(fix.sourceId, fix.status);
        break;
      case 'resolve-source-stub':
        await handleResolveStub(fix.sourceId);
        break;
      case 'remove-anchor':
        await removeBrokenAnchor(fix.notePath, fix.targetPath, fix.anchor);
        break;
      case 'merge-sources': {
        // Pick which duplicate to keep, then merge the rest into it. Not a
        // silent fix — the canonical source is the user's choice.
        const dupes = sourcesCache.filter((s) => fix.sourceIds.includes(s.sourceId));
        if (dupes.length < 2) break;
        const keepId = await dialogs.showMergeSourcesPicker(dupes);
        if (!keepId) break;
        const sd = getSourceDataStore();
        for (const other of fix.sourceIds) {
          if (other === keepId) continue;
          try {
            await sd.merge(other, keepId);
          } catch (err) {
            await showConfirm(
              `Couldn't merge "${other}": ${err instanceof Error ? err.message : String(err)}`,
              CONFIRM_KEYS.mergeSourcesFailed,
              'OK',
            );
          }
        }
        break;
      }
    }
  }

  // Nav-ops + source-view-ops handler cluster (#670): position history
  // (back/forward), file / wiki-link navigation, and the source *view* handlers
  // (open source / PDF / excerpt, show-markdown, source-deleted). Lives in
  // ./lib/app/nav-view.ts; no feature-state store. Destructured into the same
  // names so every call site reads unchanged. Placed before createSourceOps so
  // handleOpenSource is in scope for the sourceOpsCtx.openSource getter. The
  // module reads / writes pending search + preview anchor, view mode, and the
  // alias map via ctx — those `$state` decls stay in App.
  const {
    recordCurrentPosition, handleNavBack, handleNavForward, handleFileSelect, handleNavigate, handleOpenAtOffset, handleJumpToMatch,
    handleSourceDeleted, handleOpenSource, handleOpenPdf, handleShowMarkdownFromPdf, handleOpenExcerpt,
    handleOpenTypeView,
  } = createNavView({
    getEditorComponent: () => editorComponent,
    setPendingSearchQuery: (s) => { pendingSearchQuery = s; },
    setPendingPreviewAnchor: (s) => { pendingPreviewAnchor = s; },
    getViewMode: () => editor.viewMode,
    getAliasMap: () => aliasMap,
  } satisfies NavViewCtx);

  // Source-ops handler cluster (#670): source ingest (URL / file / identifier /
  // external drop / DOI-click), OCR (#95), reference mining (#106), stub
  // resolution (#107). Lives in ./lib/app/source-ops.ts; in-flight feature-dialog
  // state lives in the source-flow store; destructured into the same names so
  // every call site reads unchanged. The source *view* handlers (handleOpenSource
  // etc.) stay in App — source-ops reaches them via ctx getters.
  const sourceOpsCtx: SourceOpsCtx = {
    openSource: (id, hi) => handleOpenSource(id, hi),
    getSidebar: () => sidebar,
    refreshSourcesCache: () => refreshSourcesCache(),
    findSourceByDoi: (target) => sourcesCache.find((s) => (s.doi ?? '').toLowerCase() === target),
  };
  const {
    handleIngestUrlAsSource, handleIngestFileAsSource,
    handleIngestIdentifier, handleOcrDone, handleOcrCancel, handleMineReferences,
    handleMineReferencesApply, handleResolveStub, handleResolveStubApply, handleDoiClick,
    handleImportBibtex, handleImportZoteroRdf, handleExternalDrop,
  } = createSourceOps(sourceOpsCtx);

  // Refactor-ops handler cluster (#670): note extract / split, the two Auto-link
  // review flows, bulk tag add / remove, entrypoint toggle, selection-driven
  // Format, bibliography, and Auto-tag. Lives in ./lib/app/refactor-ops.svelte.ts;
  // in-flight Auto-link review state lives in the refactor-flow store.
  // Destructured into the same names so every call site reads unchanged. The
  // missing-API-key flow stays in App — refactor-ops reaches it via a ctx getter.
  const refactorOpsCtx: RefactorOpsCtx = {
    getSidebar: () => sidebar,
    getEditorComponent: () => editorComponent,
    maybeHandleMissingApiKey: (err) => maybeHandleMissingApiKey(err),
  };
  const {
    handleExtractSelection, handleSplitByHeading, handleSplitHere,
    handleAutoLink, handleAutoLinkInbound, handleAutoLinkInboundApply, handleAutoLinkApply,
    handleAddTag, handleRemoveTag, handleAddProperty, handleRemoveProperty, handleToggleEntrypoint,
    handleLabelVersion,
    handleFormat, handleBibliography, handleAutoTag, handleAutoTagApply,
  } = createRefactorOps(refactorOpsCtx);

  // Template / note-creation handler cluster (#670): new-note-from-conversation
  // (#177), Insert / Save-as Template (#475), new-note-about-source (#474), and
  // the excerpt → note / append flows (#101). Lives in ./lib/app/template-ops.ts;
  // no feature-state store. Destructured into the same names so every call site
  // reads unchanged. Reads the sidebar / editor component and lastNotePath via ctx.
  const {
    handleCreateNoteFromConversation, handleInsertTemplate, handleSaveAsTemplate,
    handleNewAboutSourceNote, handleCreateNoteFromExcerpt, handleAppendExcerptToCurrent,
  } = createTemplateOps({
    getSidebar: () => sidebar,
    getEditorComponent: () => editorComponent,
    getLastNotePath: () => lastNotePath,
  } satisfies TemplateOpsCtx);

  // Conversation / tool-invocation handler cluster (#670): save-cell-output
  // (#244), decompose (#515), the freeform / message / from-tool
  // conversation openers, and generic tool invocation. Lives in
  // ./lib/app/conversation-ops.ts. Placed after createNavView so handleFileSelect
  // is in scope for the openFileSelect getter; reaches the editor view + tool-
  // panel component via ctx. The conversationsStore / toolPanel store handles
  // stay in App (onMount streaming still uses them).
  const {
    handleSaveCellOutput, handleDecompose,
    openConversation, newConversation, openConversationWithMessage, handleOpenConversationFromTool, handleToolInvoke,
  } = createConversationOps({
    getEditorView: () => editorComponent?.getView(),
    getToolPanelComponent: () => toolPanelComponent,
    openFileSelect: (p) => { void handleFileSelect(p); },
  } satisfies ConversationOpsCtx);

  // Project / thoughtbase-lifecycle handler cluster (#1084): the new-thoughtbase
  // onboarding journey, the welcome-note seed, the thoughtbase-guide opener, and
  // the open / new / open-recent flows (with the three-way window prompt). Lives
  // in ./lib/app/project-ops.ts; the only App-owned state it drives is the
  // onboarding modal, bridged via `setShowOnboarding`. Destructured into the same
  // names so the welcome buttons, command palette, and native menu read unchanged.
  const {
    handleOnboardingAccept, handleOnboardingDecline, handleEditThoughtbaseDoc,
    maybeShowOnboarding, maybeOpenEntrypoints,
    handleOpenThoughtbase, handleNewThoughtbase, handleInstallTutorial, handleOpenRecentThoughtbase,
  } = createProjectOps({
    setShowOnboarding: (v) => { showOnboarding = v; },
  } satisfies ProjectOpsCtx);

  // Re-tint every canvas/CodeMirror surface that can't pick up the CSS
  // custom-property change on its own. Shared by cycle (⌘⇧T) and direct pick.
  function applyThemeToSurfaces() {
    editorComponent?.updateTheme();
    queryPanelComponent?.updateTheme();
    previewComponent?.updateTheme();
    neighborhoodGraphComponent?.updateTheme();
    rightSidebar?.updateTheme();
  }

  function handleCycleTheme() {
    themeLabel = cycleTheme();
    applyThemeToSurfaces();
    api.menu.reportTheme(themeLabel);
  }

  function handleSelectTheme(mode: ThemeMode) {
    setThemeMode(mode);
    themeLabel = mode;
    applyThemeToSurfaces();
    api.menu.reportTheme(themeLabel);
  }

  async function handleSwitchTab(index: number, groupId?: string) {
    // Focus the target pane first so the active-group delegates (editor.tabs,
    // editor.openFile, the editorComponent accessor) all operate on it (#813).
    if (groupId) editor.setActiveGroup(groupId);
    recordCurrentPosition();

    const targetTab = editor.tabs[index];
    const savedOffset = targetTab?.type === 'note' ? targetTab.cursorOffset : undefined;
    const savedScroll = targetTab?.type === 'note' ? targetTab.scrollTop : undefined;
    if (targetTab?.type === 'note') {
      await editor.openFile(targetTab.relativePath);
      if (savedOffset != null) {
        requestAnimationFrame(() => {
          editorComponent?.restorePosition(savedOffset, savedScroll);
        });
      }
      nav.record({ type: 'note', relativePath: targetTab.relativePath, offset: savedOffset ?? 0 });
    } else if (targetTab?.type === 'query') {
      editor.switchTab(index);
      nav.record({ type: 'query', tabId: targetTab.id });
    } else {
      editor.switchTab(index);
    }
  }

  function handleRevealInSidebar(relativePath: string) {
    // Reveal in the in-app file tree — switch to Notes, expand the note's
    // ancestor folders, select + scroll it into view. (The separate "Reveal
    // in Finder" menu item opens the OS file manager; this handler used to
    // call that by mistake, duplicating it.)
    void sidebar?.revealFile(relativePath);
  }

  function cycleViewMode() {
    editor.cycleViewMode();
  }

  onMount(() => {
    initTheme();
    // Tell main the current theme so the native View → Theme radio starts
    // in sync with what the renderer loaded from localStorage (#1139).
    api.menu.reportTheme(themeLabel);
    initAppearance();
    // Restore the persisted whole-window zoom (#...) — the View-menu zoom roles
    // don't persist on their own.
    applyStoredZoom();

    // All main↔renderer event wiring — the native-menu command bindings, the
    // sources/tables/embeddings/notebase-watcher/tools broadcasts, import
    // progress, the auto-save + beforeunload lifecycle hooks, the notebase.open
    // refresh patch, and the project-open restore flow — lives in
    // ./lib/app/ipc-wiring.ts (#1084). Stores are pulled there; App bridges its
    // ops handlers, component refs, and UI-chrome $state via ctx.
    registerAppIpc({
      getEditorComponent: () => editorComponent,
      getEditorComponents: () => editorComponents,
      getPreviewComponent: () => previewComponent,
      getSidebar: () => sidebar,
      getRightSidebar: () => rightSidebar,
      bumpGraphRevision: () => { graphRevision++; },
      getEditorFontSize: () => editorFontSize,
      setEditorFontSize: (n) => { editorFontSize = n; },
      toggleSidebar: () => { sidebarVisible = !sidebarVisible; },
      toggleRightSidebar: () => { rightSidebarVisible = !rightSidebarVisible; },
      setShowGotoLine: (v) => { showGotoLine = v; },
      setShowGotoNote: (v) => { showGotoNote = v; },
      setShowEditSavedQueries: (v) => { showEditSavedQueries = v; },
      setShowAbout: (v) => { showAbout = v; },
      setShowShortcuts: (v) => { showShortcuts = v; },
      setShowSettings: (v) => { showSettings = v; },
      setPublishDialogOpen: (v) => { publishDialogOpen = v; },
      setFindInNotesMode: (m) => { findInNotesMode = m; },
      setExportDialogGroup: (g) => { exportDialogGroup = g; },
      setEmbeddingProgress: (p) => { embeddingProgress = p; },
      refreshSourcesCache: () => refreshSourcesCache(),
      refreshAliasMap: () => refreshAliasMap(),
      refreshSavedQueriesCache: () => { void refreshSavedQueriesCache(); },
      refreshBacklinkCount: () => { void refreshBacklinkCount(); },
      newNote: () => { void handleNewNote(); },
      editThoughtbaseGuide: () => { void handleEditThoughtbaseDoc(); },
      openThoughtbaseProperties: () => { showThoughtbaseProperties = true; },
      save: () => { void handleSave(); },
      saveAsTemplate: () => { void handleSaveAsTemplate(); },
      saveNoteAsObjectType: () => { void handleSaveNoteAsObjectType(); },
      insertTemplate: () => { void handleInsertTemplate(); },
      cycleTheme: () => handleCycleTheme(),
      selectTheme: (mode) => handleSelectTheme(mode),
      openThoughtbase: () => { void handleOpenThoughtbase(); },
      newThoughtbase: () => { void handleNewThoughtbase(); },
      installTutorial: () => { void handleInstallTutorial(); },
      openRecentThoughtbase: (p) => { void handleOpenRecentThoughtbase(p); },
      navBack: () => { void handleNavBack(); },
      navForward: () => { void handleNavForward(); },
      rename: (p) => { void handleRename(p); },
      move: (p) => { void handleMoveWithPrompt(p); },
      copy: (p) => { void handleCopyWithPrompt(p); },
      extractSelection: () => { void handleExtractSelection(); },
      splitHere: () => { void handleSplitHere(); },
      splitByHeading: () => { void handleSplitByHeading(); },
      autoTag: (p) => { void handleAutoTag(p); },
      autoLink: (p) => { void handleAutoLink(p); },
      autoLinkInbound: (p) => { void handleAutoLinkInbound(p); },
      decompose: (p) => { void handleDecompose(p); },
      format: () => { void handleFormat(); },
      bibliography: () => { void handleBibliography(); },
      ingestUrl: () => { void handleIngestUrlAsSource(); },
      ingestIdentifier: () => { void handleIngestIdentifier(); },
      ingestFile: () => { void handleIngestFileAsSource(); },
      importBibtex: () => { void handleImportBibtex(); },
      importZoteroRdf: () => { void handleImportZoteroRdf(); },
      toolInvoke: (id) => { void handleToolInvoke(id); },
      newConversation: () => { void newConversation(); },
      cycleViewMode: () => cycleViewMode(),
      maybeShowOnboarding: () => maybeShowOnboarding(),
      maybeOpenEntrypoints: () => maybeOpenEntrypoints(),
      showProposals: () => openProposals(),
    } satisfies IpcWiringCtx);

    // Announce newly-arrived proposals (#1541): the store detects the delta and
    // coalesces bursts; we route to an in-app toast or a native notification
    // based on focus. Unsubscribe is handled by store lifetime (app session).
    proposalsStore.onArrival(handleProposalArrival);
  });

  /** Count .md notes anywhere in the tree (recursive over folder
   *  children). The onboarding trigger uses this to decide whether
   *  the thoughtbase is "empty" — folders alone don't disqualify. */
</script>

<svelte:window onkeydown={(e) => handleKeydown(e, keymapDeps)} />

<div class="app">
  <TitleBar
    notebaseName={notebase.meta?.name ?? ''}
    filePath={editor.activeFilePath}
    isDirty={editor.isDirty}
    canGoBack={nav.canGoBack}
    canGoForward={nav.canGoForward}
    onNavBack={handleNavBack}
    onNavForward={handleNavForward}
    onOpenGotoNote={() => {
      void refreshSourcesCache();
      void refreshSavedQueriesCache();
      showGotoNote = true;
    }}
    onOpenSettings={() => { showSettings = true; }}
  />

  <div class="main">
    {#if notebase.meta}
      {#if sidebarVisible}
        <Sidebar
          bind:this={sidebar}
          files={notebase.files}
          rootName={notebase.meta?.name}
          activeFilePath={editor.activeFilePath}
          onFileSelect={handleFileSelect}
          onNavigate={handleNavigate}
          onOpenAtOffset={handleOpenAtOffset}
          onNewNote={handleNewNote}
          onNewFolder={handleNewFolder}
          onDelete={handleDelete}
          onAddTag={handleAddTag}
          onLabelVersion={handleLabelVersion}
          onRemoveTag={handleRemoveTag}
          onAddProperty={handleAddProperty}
          onRemoveProperty={handleRemoveProperty}
          onFormat={() => handleFormat()}
          onRename={handleRename}
          onMerge={handleMerge}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onMove={handleMove}
          onBookmark={(path) => bookmarkStore.add(path.split('/').pop()?.replace(/\.(md|ttl|csv)$/, '') ?? path, path)}
          onToggleEntrypoint={handleToggleEntrypoint}
          onSourceSelect={(id) => handleOpenSource(id)}
          onOpenExcerpt={handleOpenExcerpt}
          onOpenType={handleOpenTypeView}
          onOpenView={handleOpenSavedView}
          onManageViews={() => { showEditSavedViews = true; }}
          onSourceDeleted={handleSourceDeleted}
          onShowConfirm={showConfirm}
          onShowPrompt={showPrompt}
          onMineReferences={handleMineReferences}
          onTableClick={(name) => editor.openQuery(`SELECT * FROM ${name}`, 'sql')}
          onOpenCsv={(rel) => handleFileSelect(rel)}
          onOpenNote={(rel) => handleFileSelect(rel)}
          onExternalDrop={handleExternalDrop}
          canPaste={clipboard.current !== null}
        />
      {/if}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="editor-pane"
        ondragover={(e) => {
          // Only react when the drag carries real files (Finder, Explorer, etc),
          // not when the user is dragging within Minerva (e.g. a FileTree row).
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        ondrop={(e) => {
          const files = e.dataTransfer?.files;
          if (!files || files.length === 0) return;
          e.preventDefault();
          // Land the drop in the folder of the active note; fall back to
          // project root when no note is open (or the note is at root).
          const activePath = editor.activeFilePath ?? '';
          const slash = activePath.lastIndexOf('/');
          const destDir = slash >= 0 ? activePath.slice(0, slash) : '';
          void handleExternalDrop(destDir, files);
        }}
      >
        <!-- Per-group pane (#813): one editor group's tab bar + active-tab
             content, rendered at each leaf of the recursive split layout.
             Clicking anywhere in a pane focuses its group so the active-group
             delegates (commands, status bar, right sidebar) follow it. -->
        {#snippet groupPane(groupId: string)}
          {@const group = editor.groups.find((g) => g.id === groupId)}
          {#if group}
            {@const active = group.tabs[group.activeIndex] ?? null}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="group-pane"
              class:focused={groupId === editor.activeGroupId && editor.groups.length > 1}
              data-group-id={groupId}
              onpointerdowncapture={() => editor.setActiveGroup(groupId)}
            >
              {#if group.tabs.length > 0}
                <TabBar
                  tabs={group.tabs}
                  activeIndex={group.activeIndex}
                  sources={sourcesCache}
                  onSwitch={(i) => handleSwitchTab(i, groupId)}
                  onClose={(i) => editor.closeTab(i, groupId)}
                  onCloseOthers={(i) => editor.closeOthers(i, groupId)}
                  onCloseAll={() => editor.closeAll(groupId)}
                  onCloseAllInGroup={() => editor.closeAllAndCollapse(groupId)}
                  otherGroups={otherGroupsFor(groupId)}
                  onMoveToGroup={(i, targetGroupId) => editor.moveTab(groupId, i, targetGroupId)}
                  onReveal={handleRevealInSidebar}
                  onOpenConversation={openConversation}
                  onBookmark={(path) => bookmarkStore.add(path.split('/').pop()?.replace(/\.(md|ttl|csv)$/, '') ?? path, path)}
                  onNewTab={() => { editor.setActiveGroup(groupId); void handleNewNote(); }}
                  onTabPointerDown={(i, e) => onTabPointerDown(groupId, i, e)}
                />
              {/if}
              {#if active?.type === 'note'}
                <BreadcrumbsBar
                  filePath={active.relativePath}
                  content={active.content}
                  cursorLine={cursorInfo.line}
                  showHeadings={breadcrumbsSettings.showHeadingChain}
                  onRevealFolder={(folder) => { void sidebar?.revealFolder(folder); }}
                  onScrollToLine={(line) => editorComponents[groupId]?.gotoLineColumn(line, 1)}
                />
              {/if}
              {#if active?.type === 'note' && active.relativePath.endsWith('.csv')}
                <CsvTable relativePath={active.relativePath} content={active.content} />
              {:else if active?.type === 'note'}
                {@const note = active}
                {@const hasRunnableFences =
                  findRunnableFences(note.content, RUNNABLE_LANGUAGE_SET).length > 0}
                <div class="toolbar">
                  {#if hasRunnableFences}
                    <button
                      class="nav-btn run-all-btn"
                      onclick={() => {
                        // Prefer the editor (writes through CodeMirror so the
                        // edit lands in undo history / cursor state); fall back
                        // to the preview when it's the only surface mounted
                        // (preview-only view mode).
                        const surface = editorComponents[groupId] ?? previewComponents[groupId];
                        void surface?.runAllCells();
                      }}
                      title="Recompute all cells (top to bottom, stops on error)"
                    ><Icon name="run-all" size={12} /></button>
                  {/if}
                  {#if !note.plainText}
                    <!-- A plain-text file has no rendered preview (#1130) — the
                         source/preview toggle would offer empty views. -->
                    <div class="view-toggle">
                      <button
                        class:active={group.viewMode === 'source'}
                        onclick={() => editor.setViewMode('source', groupId)}
                        title="Source (Cmd+Shift+P to cycle)"
                      >Source</button>
                      <button
                        class:active={group.viewMode === 'editor-preview'}
                        onclick={() => editor.setViewMode('editor-preview', groupId)}
                        title="Source + preview side by side"
                      >Side by side</button>
                      <button
                        class:active={group.viewMode === 'preview'}
                        onclick={() => editor.setViewMode('preview', groupId)}
                        title="Preview"
                      >Preview</button>
                    </div>
                  {/if}
                  <button
                    class="nav-btn"
                    onclick={() => editor.splitGroup(groupId, 'horizontal')}
                    title="Split right"
                  ><Icon name="split-h" size={12} /></button>
                  <button
                    class="nav-btn"
                    onclick={() => editor.splitGroup(groupId, 'vertical')}
                    title="Split down"
                  ><Icon name="split-v" size={12} /></button>
                  <button
                    class="nav-btn new-conversation-btn"
                    onclick={() => { void newConversation(); }}
                    title="New Conversation"
                  ><Icon name="conversation" size={12} /><span>New Conversation</span></button>
                  <button
                    class="nav-btn sidebar-toggle"
                    class:active={rightSidebarVisible}
                    onclick={() => { rightSidebarVisible = !rightSidebarVisible; }}
                    title="Toggle Right Sidebar (Cmd+Shift+B)"
                  ><Icon name="outline" size={12} /></button>
                </div>
                <div class="editor-content" class:editor-preview={group.viewMode === 'editor-preview' && !note.plainText}>
                  {#if note.plainText || group.viewMode === 'source' || group.viewMode === 'editor-preview'}
                    <div class="editor-panel">
                      {#key groupId + ':' + note.relativePath}
                        <Editor
                          bind:this={editorComponents[groupId]}
                          groupId={groupId}
                          filePath={note.relativePath}
                          content={note.content}
                          plainText={note.plainText ?? false}
                          initialHistory={note.historyJson}
                          searchQuery={pendingSearchQuery}
                          onContentChange={(text) => editor.setContent(text, groupId)}
                          onSave={handleSave}
                          onSearchQueryConsumed={() => { pendingSearchQuery = null; }}
                          onEditorStateSave={editor.saveEditorState}
                          onCursorChange={(info) => { cursorInfo = info; }}
                          onNavigate={handleNavigate}
                          onOpenSource={handleOpenSource}
                          onOpenExcerpt={handleOpenExcerpt}
                          getNotePaths={() => flattenNotePaths(notebase.files)}
                          getSources={() => sourcesCache}
                          getAliases={() => aliasEntries}
                          onCreateNoteFromReference={(target) => void createNoteFromReference(noteTargetPathBeside(note.relativePath, target))}
                          resolveInlineTypeCreate={handleInlineTypeCreate}
                          bookmarks={collectBookmarksForPath(bookmarkStore.tree, note.relativePath)}
                          onUploadError={(message) => {
                            void showConfirm(message, CONFIRM_KEYS.imageUploadFailed, 'OK');
                          }}
                          onRunCell={(language, code, notePath) =>
                            runCellWithTrust(language, code, notePath, { showConsent: showComputeConsent })
                          }
                          menuOps={{
                            invokeTool: handleToolInvoke,
                            openConversation: openConversation,
                            bookmark: () => bookmarkStore.add(note.fileName.replace(/\.(md|ttl|csv)$/, ''), note.relativePath),
                            bookmarkSection: () => { void handleBookmarkSection(); },
                            bookmarkLine: handleBookmarkLine,
                            extractSelection: handleExtractSelection,
                            splitHere: handleSplitHere,
                            splitByHeading: handleSplitByHeading,
                            rename: () => void handleRename(note.relativePath),
                            move: () => void handleMoveWithPrompt(note.relativePath),
                            copyFile: () => void handleCopyWithPrompt(note.relativePath),
                            merge: () => handleMerge(note.relativePath),
                            autoTag: () => void handleAutoTag(note.relativePath),
                            autoLink: () => void handleAutoLink(note.relativePath),
                            autoLinkInbound: () => void handleAutoLinkInbound(note.relativePath),
                            formatCurrentNote: () => handleFormat(),
                            addTagCurrentNote: () => void handleAddTag(note.relativePath, false, { targetOnly: true }),
                            removeTagCurrentNote: () => void handleRemoveTag(note.relativePath, false, { targetOnly: true }),
                            addPropertyCurrentNote: () => void handleAddProperty(note.relativePath, false, { targetOnly: true }),
                            removePropertyCurrentNote: () => void handleRemoveProperty(note.relativePath, false, { targetOnly: true }),
                            insertQueryList: async () => {
                              const tag = await showPrompt('Tag name:');
                              if (!tag) return;
                              const block = `\n:::query-list\nSELECT ?title ?path WHERE {\n  ?note minerva:hasTag ?t .\n  ?t minerva:tagName "${tag}" .\n  ?note dc:title ?title .\n  ?note minerva:relativePath ?path .\n} ORDER BY ?title\n:::\n`;
                              editorComponents[groupId]?.insertText(block);
                            },
                          }}
                        />
                      {/key}
                    </div>
                  {/if}
                  {#if !note.plainText && (group.viewMode === 'preview' || group.viewMode === 'editor-preview')}
                    <div class="preview-panel">
                      <Preview
                        bind:this={previewComponents[groupId]}
                        content={note.content}
                        notePath={note.relativePath}
                        previewScrollTop={note.previewScrollTop}
                        onScrollPositionSave={editor.savePreviewScroll}
                        {numberedHeadings}
                        getNotePaths={() => flattenNotePaths(notebase.files)}
                        getAliases={() => aliasEntries}
                        revision={graphRevision}
                        onNavigate={handleNavigate}
                        onCreateNoteFromReference={(target) => void createNoteFromReference(noteTargetPathBeside(note.relativePath, target))}
                        onTagSelect={handleTagSelect}
                        onOpenSource={handleOpenSource}
                        onOpenExcerpt={handleOpenExcerpt}
                        pendingAnchor={pendingPreviewAnchor}
                        onAnchorResolved={() => { pendingPreviewAnchor = null; }}
                        onTaskToggle={handleTaskToggle}
                        onDoiClick={handleDoiClick}
                        onSaveCellOutput={handleSaveCellOutput}
                        onToolInvoke={handleToolInvoke}
                        onOpenConversation={openConversation}
                        onBookmark={() => bookmarkStore.add(note.fileName.replace(/\.(md|ttl|csv)$/, ''), note.relativePath)}
                        onRunCell={(language, code, notePath) =>
                          runCellWithTrust(language, code, notePath, { showConsent: showComputeConsent })
                        }
                        onApplyCellOutputEdit={(newContent) => { editor.setContent(newContent, groupId); }}
                      />
                    </div>
                  {/if}
                </div>
              {:else if active?.type === 'query'}
                <QueryPanel
                  bind:this={queryPanelComponents[groupId]}
                  tab={active}
                  onQueryChange={editor.setQueryText}
                  onLanguageChange={editor.setQueryLanguage}
                  onExecute={editor.executeQuery}
                  onSave={handleSaveQuery}
                />
              {:else if active?.type === 'source'}
                {#key active.sourceId}
                  <SourceDetail
                    sourceId={active.sourceId}
                    highlightExcerptId={active.highlightExcerptId}
                    {numberedHeadings}
                    onNavigate={handleNavigate}
                    onShowConfirm={showConfirm}
                    onShowPrompt={showPrompt}
                    onDeleted={handleSourceDeleted}
                    onCreateAboutNote={handleNewAboutSourceNote}
                    onOpenReference={handleOpenSource}
                    onResolveStub={handleResolveStub}
                    onOpenPdf={handleOpenPdf}
                    onCreateNoteFromExcerpt={handleCreateNoteFromExcerpt}
                    onAppendExcerptToCurrent={handleAppendExcerptToCurrent}
                    canAppendToCurrent={lastNotePath !== null}
                    onAttachEvidence={(id) => { attachEvidenceExcerptId = id; }}
                    onInvokeTool={handleToolInvoke}
                  />
                {/key}
              {:else if active?.type === 'pdf'}
                {#key active.sourceId}
                  <!-- Lazy: pdfjs-dist only loads when a PDF tab is opened (#691). -->
                  {#await import('./lib/components/PdfViewer.svelte') then { default: PdfViewer }}
                    <PdfViewer
                      sourceId={active.sourceId}
                      initialPage={active.page}
                      onShowMarkdown={handleShowMarkdownFromPdf}
                    />
                  {/await}
                {/key}
              {:else if active?.type === 'graph'}
                {#key active.relativePath}
                  <NeighborhoodGraph
                    bind:this={neighborhoodGraphComponents[groupId]}
                    relativePath={active.relativePath}
                    depth={active.depth}
                    revision={graphRevision}
                    onOpenNote={(p) => handleFileSelect(p)}
                  />
                {/key}
              {:else if active?.type === 'type-view'}
                {#key active.typeId}
                  <TypeView
                    typeId={active.typeId}
                    layout={active.layout}
                    sortColumn={active.sortColumn}
                    sortDir={active.sortDir}
                    columns={active.columns}
                    revision={graphRevision}
                    onStateChange={(patch) => editor.setTypeViewState(active.typeId, patch)}
                    onOpenNote={(p) => handleFileSelect(p)}
                    {...(notebase.meta ? { onSaveView: () => handleSaveView(active) } : {})}
                  />
                {/key}
              {:else if active?.type === 'unsupported'}
                <!-- No in-app renderer for this file type (#1130). A calm panel
                     (not an error, per the UI philosophy) with escape hatches to
                     the OS. Capture primitives, not the reactive tab, so the
                     button handlers can't read a stale path. -->
                {@const relPath = active.relativePath}
                {@const extLabel = active.ext ? `${active.ext} files` : 'this file type'}
                <div class="no-file no-preview">
                  <p>No preview for {extLabel}</p>
                  <p class="no-preview-name">{active.fileName}</p>
                  <div class="no-preview-actions">
                    <button onclick={() => void api.shell.revealFile(relPath)}>Reveal in Finder</button>
                    <button onclick={() => void api.shell.openInDefault(relPath)}>Open with default app</button>
                    <button onclick={() => void navigator.clipboard.writeText(relPath)}>Copy path</button>
                  </div>
                </div>
              {:else if editor.groups.length > 1}
                <!-- A freshly split pane is empty until a note lands in it.
                     It has no tab bar, so offer a way back out (#817). -->
                <div class="no-file empty-pane">
                  <p>Empty pane</p>
                  <p class="empty-pane-hint">Open a note from the sidebar to fill it.</p>
                  <button class="empty-pane-close" onclick={() => editor.collapseGroup(groupId)}>
                    Close this pane
                  </button>
                </div>
              {:else}
                <div class="no-file">
                  <p>Press {formatAccelerator('CmdOrCtrl+N')} to create a new note</p>
                </div>
              {/if}
              {#if draggingTab && dropTarget?.groupId === groupId}
                <div class="drop-preview {dropTarget.zone}"></div>
              {/if}
            </div>
          {/if}
        {/snippet}

        <SplitContainer node={editor.layout} leaf={groupPane} onLayoutChange={() => editor.schedulePersistTabs()} />

        <!-- One window-level status bar that reflects the focused group's note
             (word count, cursor, dirty state) — the deliberate #817 choice over
             a bar per pane: it tracks `editor.activeTab`, which follows the
             active group. -->
        {#if editor.activeTab?.type === 'note'}
          <StatusBar
            cursor={cursorInfo}
            fontSize={editorFontSize}
            theme={themeLabel}
            {inspectionCount}
            pendingCount={proposalsStore.pendingCount}
            {backlinkCount}
            backfill={embeddingProgress}
            isDirty={editor.isDirty}
            hasActiveNote={editor.activeTab?.type === 'note'}
            onGotoLine={() => { showGotoLine = true; }}
            onSelectTheme={handleSelectTheme}
            onShowInspections={() => { rightSidebarVisible = true; }}
            onShowBacklinks={() => {
              rightSidebarVisible = true;
              rightSidebar?.showPanel('backlinks');
            }}
            onShowProposals={openProposals}
            onToggleDictation={() => { void toggleEditorDictation(editorComponent?.getView() ?? null); }}
            dictationActive={voice.surface === 'editor' && voice.busy}
            dictationDisabled={editor.viewMode === 'preview'}
          />
        {/if}
        <!-- ToolPanel is mounted for ANY active tab, not just notes (#1514):
             source-scoped tools (e.g. Extract Key Claims) run from a source tab
             and route through toolPanelComponent.startExecution(), which no-ops
             if the panel isn't bound. It renders nothing until a tool runs, so
             mounting it unconditionally is invisible on non-note tabs. -->
        <ToolPanel
          bind:this={toolPanelComponent}
          onNoteCreated={() => { void notebase.refresh(); sidebar?.refreshTags(); }}
          onOpenConversation={handleOpenConversationFromTool}
          onMissingApiKey={() => { void handleMissingApiKey(); }}
        />
      </div>
      {#if rightSidebarVisible && editor.activeTab?.type === 'note'}
        <RightSidebar
          bind:this={rightSidebar}
          activeFilePath={editor.activeFilePath}
          content={editor.content}
          onFileSelect={handleFileSelect}
          onNavigate={handleNavigate}
          onOpenAtOffset={handleOpenAtOffset}
          onScrollToLine={(line) => editorComponent?.gotoLineColumn(line, 1)}
          onOpenConversation={(msg) => { void openConversationWithMessage(msg); }}
          onApplyInspectionFix={applyInspectionFix}
          onOpenQuery={(sql) => editor.openQuery(sql, 'sql')}
          onOpenSource={handleOpenSource}
          onOpenExcerpt={handleOpenExcerpt}
          onContentChange={editor.setContent}
          onOpenGraph={(p) => editor.openNeighborhood(p)}
          indexing={embeddingProgress !== null}
        />
      {/if}
    {:else}
      <div class="welcome">
        <h1>Minerva</h1>
        <p>An integrated knowledge management environment</p>
        <div class="welcome-actions">
          <button onclick={handleNewThoughtbase}>New Thoughtbase</button>
          <button onclick={notebase.open}>Open Thoughtbase</button>
          <button onclick={handleInstallTutorial}>Take the Tutorial</button>
        </div>
      </div>
    {/if}
  </div>

  {#if notebase.meta}
    {#key notebase.meta.rootPath}
      <ConversationsPanel
        currentNotePath={editor.activeFilePath ?? null}
        onCreateNoteFromConversation={handleCreateNoteFromConversation}
        onInvokeSkill={(id) => { void handleToolInvoke(id); }}
      />
    {/key}
  {/if}

  {#if showGotoNote}
    <GotoNoteDialog
      files={notebase.files}
      sources={sourcesCache}
      savedQueries={savedQueriesCache}
      onSelect={(path) => { showGotoNote = false; void handleFileSelect(path); }}
      onSelectSource={(id) => { showGotoNote = false; handleOpenSource(id); }}
      onSelectQuery={(q) => { showGotoNote = false; editor.openQuery(q.query, q.language ?? 'sparql'); }}
      onCancel={() => { showGotoNote = false; }}
    />
  {/if}
  {#if mergePickerSource}
    <GotoNoteDialog
      files={notebase.files}
      placeholder="Merge into note..."
      excludePath={mergePickerSource}
      onSelect={(path) => {
        const src = mergePickerSource;
        mergePickerSource = null;
        if (src) void performMerge(src, path);
      }}
      onCancel={() => { mergePickerSource = null; }}
    />
  {/if}
  {#if showGotoLine}
    {@const pos = editorComponent?.getCursorPosition() ?? { line: 1, column: 1 }}
    <GotoLineDialog
      currentLine={pos.line}
      currentColumn={pos.column}
      onGoto={(line, col) => {
        recordCurrentPosition();
        editorComponent?.gotoLineColumn(line, col);
        showGotoLine = false;
        if (editor.activeFilePath && editorComponent) {
          // Capture the narrowed values before rAF — TS forgets the
          // narrowing across the closure boundary.
          const path = editor.activeFilePath;
          const ec = editorComponent;
          requestAnimationFrame(() => {
            nav.record({ type: 'note', relativePath: path, offset: ec.getOffset() });
          });
        }
      }}
      onCancel={() => { showGotoLine = false; }}
    />
  {/if}
  {#if showEditSavedQueries}
    <EditSavedQueriesDialog projectOpen={!!notebase.meta} onClose={() => { showEditSavedQueries = false; }} />
  {/if}
  {#if showEditSavedViews}
    <EditSavedViewsDialog onClose={() => { showEditSavedViews = false; }} />
  {/if}
  {#if attachEvidenceExcerptId}
    <AttachEvidenceDialog
      excerptId={attachEvidenceExcerptId}
      onClose={() => { attachEvidenceExcerptId = null; }}
      onAttach={handleAttachEvidence}
    />
  {/if}
  {#if typeEditorState}
    <TypeEditorDialog
      initial={typeEditorState.initial}
      onClose={() => { typeEditorState = null; }}
      onSaved={handleTypeEditorSaved}
    />
  {/if}
  {#if saveQueryRequest}
    <SaveQueryDialog
      projectOpen={!!notebase.meta}
      initialName={saveQueryRequest.initialName}
      initialScope={saveQueryRequest.initialScope}
      onConfirm={saveQueryRequest.onConfirm}
      onCancel={saveQueryRequest.onCancel}
    />
  {/if}
  {#if sourceFlow.ocrSession && sourceFlow.ocrPdfBytes}
    <!-- Lazy: tesseract.js (multi-MB WASM) + pdfjs only load when OCR actually
         runs, keeping them out of the eager startup graph (#691). -->
    {#await import('./lib/components/OcrProgressDialog.svelte') then { default: OcrProgressDialog }}
      <OcrProgressDialog
        pdfBytes={sourceFlow.ocrPdfBytes}
        pageCount={sourceFlow.ocrSession.pageCount}
        title={sourceFlow.ocrSession.title}
        onDone={handleOcrDone}
        onCancel={handleOcrCancel}
      />
    {/await}
  {/if}
  {#if findInNotesMode}
    <FindInNotesDialog
      initialMode={findInNotesMode}
      onJumpTo={handleJumpToMatch}
      onClose={() => { findInNotesMode = null; }}
    />
  {/if}
  <DialogHost />

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
      onApply={handleMineReferencesApply}
      onCancel={() => sourceFlow.setMineReview(null)}
    />
  {/if}
  {#if sourceFlow.resolveStub}
    <ResolveStubDialog
      stubTitle={sourceFlow.resolveStub.stubTitle}
      candidates={sourceFlow.resolveStub.candidates}
      onApply={handleResolveStubApply}
      onCancel={() => sourceFlow.setResolveStub(null)}
    />
  {/if}
  {#if safeDeleteDialogState}
    {@const st = safeDeleteDialogState}
    <SafeDeleteBlockerDialog
      selectionCount={st.selectionCount}
      targets={st.targets}
      blockers={st.blockers}
      onCancel={() => { safeDeleteDialogState = null; }}
      onDeleteAnyway={async () => {
        safeDeleteDialogState = null;
        await st.proceed();
      }}
      onOpenFirstReference={(source, target) => {
        void openFirstReferenceFromSafeDelete(source, target);
      }}
    />
  {/if}
  {#if showCommandPalette}
    <CommandPaletteDialog
      {commands}
      onClose={() => { showCommandPalette = false; }}
    />
  {/if}
  <DictationIndicator />
  <Toasts />
  {#if showAbout}
    <AboutDialog onClose={() => { showAbout = false; }} />
  {/if}
  {#if showShortcuts}
    <ShortcutsDialog onClose={() => { showShortcuts = false; }} />
  {/if}
  {#if exportDialogGroup}
    <ExportDialog
      group={exportDialogGroup}
      activeFilePath={editor.activeFilePath}
      activeSourceId={editor.activeSourceTab?.sourceId ?? null}
      onCancel={() => { exportDialogGroup = null; }}
      onExported={async (result) => {
        exportDialogGroup = null;
        const pathPreview = formatCappedList(result.writtenPaths, (p: string) => `  • ${p}`, { moreIndent: '  ' });
        await showConfirm(
          `${result.summary}\n\nFiles written:\n${pathPreview}`,
          CONFIRM_KEYS.exportComplete,
          'OK',
        );
      }}
    />
  {/if}
  {#if publishDialogOpen}
    <PublishDialog onClose={() => { publishDialogOpen = false; }} />
  {/if}
  {#if refactorFlow.autoLinkReview}
    <AutoLinkDialog
      suggestions={refactorFlow.autoLinkReview.suggestions}
      activeNoteBody={refactorFlow.autoLinkReview.activeBody}
      onApply={handleAutoLinkApply}
      onCancel={() => refactorFlow.setAutoLinkReview(null)}
    />
  {/if}
  {#if refactorFlow.autoLinkInboundReview}
    <AutoLinkInboundDialog
      suggestions={refactorFlow.autoLinkInboundReview.suggestions}
      activeStem={refactorFlow.autoLinkInboundReview.relativePath.replace(/\.md$/i, '')}
      onApply={handleAutoLinkInboundApply}
      onCancel={() => refactorFlow.setAutoLinkInboundReview(null)}
    />
  {/if}
  {#if refactorFlow.autoTagReview}
    <AutoTagDialog
      tags={refactorFlow.autoTagReview.tags}
      relativePath={refactorFlow.autoTagReview.relativePath}
      onApply={handleAutoTagApply}
      onCancel={() => refactorFlow.setAutoTagReview(null)}
    />
  {/if}
  {#if busy.label}
    <BusyOverlay label={busy.label} />
  {/if}
  {#if showSettings}
    <SettingsDialog
      onApplyEditor={(s) => {
        // applySettings both persists and live-reconfigures the editor, but it
        // no-ops when no editor view is mounted (e.g. Done pressed on a source
        // tab). Persist here too so preview-only settings like numberedHeadings
        // survive regardless, and mirror the value so open previews react now.
        saveEditorSettings(s);
        editorComponent?.applySettings(s);
        numberedHeadings = s.numberedHeadings;
      }}
      onApplyFontSize={(px) => {
        // The Settings numeric control sets an absolute editor font size.
        // Apply to every open pane so a split view stays consistent, mirror the
        // status-bar value, and persist even when no editor is mounted.
        const next = clampFontSize(px);
        editorFontSize = next;
        const editors = Object.values(editorComponents).filter((e): e is Editor => e !== undefined);
        if (editors.length > 0) for (const ec of editors) ec.setFontSize(next);
        else localStorage.setItem('editorFontSize', String(next));
      }}
      onThemeChanged={() => {
        themeLabel = getThemeMode();
        editorComponent?.updateTheme();
        queryPanelComponent?.updateTheme();
        previewComponent?.updateTheme();
        neighborhoodGraphComponent?.updateTheme();
        rightSidebar?.updateTheme();
      }}
      onClose={() => {
        showSettings = false;
        settingsInitialTab = undefined;
        // Re-read breadcrumb settings — the dialog wrote through to the
        // module cache on change, but App's reactive state needs a nudge.
        breadcrumbsSettings = { ...getBreadcrumbsSettings() };
      }}
      initialTab={settingsInitialTab}
    />
  {/if}
  {#if showOnboarding}
    <OnboardingDialog
      onAccept={(answers, dontAskAgain) => { void handleOnboardingAccept(answers, dontAskAgain); }}
      onDecline={(dontAskAgain) => { void handleOnboardingDecline(dontAskAgain); }}
      onStartFromType={() => { showOnboarding = false; void handleNewNote(); }}
    />
  {/if}

  {#if showThoughtbaseProperties}
    <ThoughtbaseProperties
      onSave={async ({ name, baseUri }) => {
        await notebase.setDisplayName(name);
        if (baseUri !== undefined) {
          const r = await notebase.setBaseUri(baseUri);
          if (!r.ok) return r; // keep the dialog open to show the refusal/error
        }
        showThoughtbaseProperties = false;
        return { ok: true };
      }}
      onCancel={() => { showThoughtbaseProperties = false; }}
    />
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .editor-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* One editor group's pane within the split layout (#813). Fills its leaf
     cell; stacks tab bar → breadcrumbs → content. */
  .group-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    /* Anchor for the absolutely-positioned drag-to-split overlay (#817). */
    position: relative;
  }
  /* Subtle focus ring on the active pane — only meaningful once split. */
  .group-pane.focused {
    box-shadow: inset 0 2px 0 0 var(--accent);
  }

  /* Drag-tab-to-split preview (#817): a faint accent wash over the half/area the
     dragged tab will land in. pointer-events:none so the hit-test
     (elementFromPoint) still resolves to the pane underneath. The inset
     transition glides the highlight between zones instead of hard-snapping. */
  .drop-preview {
    position: absolute;
    z-index: 6;
    pointer-events: none;
    background: color-mix(in oklch, var(--accent) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 45%, transparent);
    transition: inset 90ms ease;
  }
  .drop-preview.left { inset: 0 50% 0 0; }
  .drop-preview.right { inset: 0 0 0 50%; }
  .drop-preview.top { inset: 0 0 50% 0; }
  .drop-preview.bottom { inset: 50% 0 0 0; }
  .drop-preview.center { inset: 0; }

  /* While a tab drags, kill text selection and show a grabbing cursor app-wide
     (pointer-based drag, so no native drag cursor — #817). */
  :global(body.tab-dragging) {
    cursor: grabbing;
    user-select: none;
  }

  /* Drag-to-add-link (#1129): app-wide grabbing cursor + no selection. */
  :global(body.link-dragging) {
    cursor: grabbing;
    user-select: none;
  }
  /* The chip that follows the pointer while dragging a note/source in. */
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

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .sidebar-toggle.active {
    color: var(--accent);
  }

  /* New Conversation is a primary action — a labeled, accent-tinted button
     pinned to the right of the toolbar (always visible while editing) rather
     than a bare "+" buried in the conversations panel header (#1035). */
  .new-conversation-btn {
    -webkit-app-region: no-drag;
    margin-left: auto;
    /* Breathing room before the right-sidebar toggle that follows. */
    margin-right: 6px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: auto;
    height: auto;
    padding: 3px 10px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: transparent;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
  }

  .new-conversation-btn:hover {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
  }

  .view-toggle {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    /* Breathing room before the split buttons that follow. */
    margin-right: 8px;
  }

  /* Separate the Recompute-all button from the view toggle to its right.
     The margin lives on the button (not the toggle) so a note without
     runnable fences — where the button is absent — keeps the toggle flush
     against the toolbar's left padding. */
  .run-all-btn {
    margin-right: 8px;
  }

  .view-toggle button {
    padding: 3px 12px;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
    border-right: 1px solid var(--border);
  }

  .view-toggle button:last-child {
    border-right: none;
  }

  .view-toggle button.active {
    background: var(--bg-button-hover);
    color: var(--text);
  }

  .view-toggle button:hover:not(.active) {
    background: var(--bg-button);
  }

  .editor-content {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .editor-content.editor-preview {
    gap: 1px;
    background: var(--border);
  }

  .editor-panel {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .preview-panel {
    flex: 1;
    display: flex;
    overflow: hidden;
    background: var(--bg);
  }

  .no-file {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .no-file p {
    color: var(--text-muted);
    font-size: 14px;
  }

  .empty-pane {
    flex-direction: column;
    gap: 6px;
  }
  .empty-pane-hint {
    font-size: 12px !important;
    opacity: 0.8;
  }
  .empty-pane-close {
    margin-top: 8px;
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text);
    background: var(--bg-button);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .empty-pane-close:hover {
    border-color: var(--accent);
  }

  /* "No preview for .xyz" panel (#1130) — reuses the calm .no-file empty-state
     look; no danger styling (per the UI philosophy). */
  .no-preview {
    flex-direction: column;
    gap: 4px;
  }
  .no-preview-name {
    font-size: 12px !important;
    color: var(--text-faint) !important;
    font-family: var(--font-mono);
  }
  .no-preview-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .no-preview-actions button {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text);
    background: var(--bg-button);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
  }
  .no-preview-actions button:hover {
    border-color: var(--accent);
  }

  .welcome {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .welcome h1 {
    font-size: 28px;
    font-weight: 300;
    color: var(--text);
  }

  .welcome p {
    color: var(--text-muted);
    font-size: 14px;
  }

  .welcome button {
    -webkit-app-region: no-drag;
    padding: 10px 24px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .welcome button:hover {
    background: var(--bg-button-hover);
  }

  .welcome-actions {
    display: flex;
    gap: 12px;
  }

  /* New Thoughtbase is the primary action for a first-time user. */
  .welcome-actions button:first-child {
    border-color: var(--accent);
  }
</style>
