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
  import RightSidebar from './lib/components/RightSidebar.svelte';
  import StatusBar from './lib/components/StatusBar.svelte';
  import BreadcrumbsBar from './lib/components/BreadcrumbsBar.svelte';
  import { getBreadcrumbsSettings, type BreadcrumbsSettings } from './lib/breadcrumbs/settings';
  import Icon from './lib/components/Icon.svelte';
  import type { CursorInfo } from './lib/components/Editor.svelte';
  import Preview from './lib/components/Preview.svelte';
  import SourceDetail from './lib/components/SourceDetail.svelte';
  import { onMount, tick } from 'svelte';
  import { getNotebaseStore } from './lib/stores/notebase.svelte';
  import { getEditorStore } from './lib/stores/editor.svelte';
  import { getBusyStore } from './lib/stores/busy.svelte';
  import { getClipboardStore } from './lib/stores/clipboard.svelte';
  import { getSourceFlowStore } from './lib/stores/source-flow.svelte';
  import { getRefactorFlowStore } from './lib/stores/refactor-flow.svelte';
  import { createNoteOps, type NoteOpsCtx } from './lib/app/note-ops';
  import { createSourceOps, type SourceOpsCtx } from './lib/app/source-ops';
  import { createNavView, type NavViewCtx } from './lib/app/nav-view';
  import { createRefactorOps, type RefactorOpsCtx } from './lib/app/refactor-ops.svelte';
  import { createTemplateOps, type TemplateOpsCtx } from './lib/app/template-ops';
  import { createConversationOps, type ConversationOpsCtx } from './lib/app/conversation-ops';
  import DialogHost from './lib/components/DialogHost.svelte';
  import { getDialogStore } from './lib/stores/dialogs.svelte';
  import { getLinkDrag } from './lib/stores/link-drag.svelte';
  // PdfViewer + OcrProgressDialog are loaded lazily at their render sites
  // (`{#await import()}`) so pdfjs-dist + tesseract.js stay out of the eager
  // startup graph (#691).
  import MineReferencesDialog from './lib/components/MineReferencesDialog.svelte';
  import ResolveStubDialog from './lib/components/ResolveStubDialog.svelte';
  import SafeDeleteBlockerDialog from './lib/components/SafeDeleteBlockerDialog.svelte';
  import type { SafeDeleteBlocker } from '../shared/types';
  import CommandPaletteDialog from './lib/components/CommandPaletteDialog.svelte';
  import type { Command } from './lib/command-palette/types';
  import { buildCommandRegistry, type CommandDeps } from './lib/command-palette/registry';
  import DictationIndicator from './lib/components/DictationIndicator.svelte';
  import { toggleEditorDictation } from './lib/editor/dictation';
  import { handleKeydown, type KeymapDeps } from './lib/keymap/handle-keydown';
  import ExportDialog from './lib/components/ExportDialog.svelte';
  import PublishDialog from './lib/components/PublishDialog.svelte';
  import AboutDialog from './lib/components/AboutDialog.svelte';
  import ShortcutsDialog from './lib/components/ShortcutsDialog.svelte';
  import GotoLineDialog from './lib/components/GotoLineDialog.svelte';
  import EditSavedQueriesDialog from './lib/components/EditSavedQueriesDialog.svelte';
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
  import type { OnboardingAnswers } from './lib/components/OnboardingDialog.svelte';
  import { api } from './lib/ipc/client';
  import { getNavigationStore } from './lib/stores/navigation.svelte';
  import { initTheme, cycleTheme, getThemeMode, setThemeMode, type ThemeMode } from './lib/theme';
  import { getEditorSettings, saveEditorSettings } from './lib/editor/settings';
  import {
    slugifyForPath,
    flattenNotePaths,
    countNotes,
    lineBookmarkName,
  } from './lib/app/text-helpers';
  import { initAppearance } from './lib/appearance/settings';
  import { getToolPanelStore } from './lib/stores/tool-panel.svelte';
  import { getConversationsStore } from './lib/stores/conversations.svelte';
  import { getBookmarksStore, collectBookmarksForPath } from './lib/stores/bookmarks.svelte';
  import { CONFIRM_KEYS } from './lib/confirm-keys';
  import { sectionAnchorAt } from './lib/markdown/headings';
  import { isMissingApiKeyError } from '../shared/llm-errors';
  import { ENTRYPOINT_TAG } from '../shared/entrypoint';
  import { runCellWithTrust } from './lib/compute/run-cell-with-trust';
  import { findRunnableFences, RUNNABLE_LANGUAGE_SET } from '../shared/compute/fences';
  import { loadFormatSettings } from './lib/formatter/settings';
  import { toggleTaskOnLine } from './lib/editor/task-toggle';
  import { registerSkillInfos } from './lib/tools/tool-registry';
  import { applyMenuConfig } from '../shared/skills/menu-config';


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
  const toolPanel = getToolPanelStore();
  const conversationsStore = getConversationsStore();
  const bookmarkStore = getBookmarksStore();
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

  // Inspections hidden for v1.0 — kept at 0 (no polling), so the status-bar
  // badge never shows. See the disabled polling in the project-open handler.
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
  // block on `isMissingApiKeyError`; we read the flag here (which makes
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
  const { showPrompt, showConfirm } = dialogs;
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
    if (!isMissingApiKeyError(err)) return false;
    await handleMissingApiKey();
    return true;
  }
  async function handleMissingApiKey(): Promise<void> {
    if (missingApiKeyPromptShown) return;
    missingApiKeyPromptShown = true;
    try {
      const ok = await showConfirm(
        'This action needs an Anthropic API key, which isn’t configured yet. ' +
          'Open Settings → AI to paste your key, or set the ANTHROPIC_API_KEY ' +
          'environment variable before launching the app.',
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

  /** Build the system prompt + first message for the new-thoughtbase
   *  onboarding journey. The prompt instructs the agent to draft an
   *  index + linked child notes via `propose_notes` so the user gets
   *  the same review-the-bundle UX as the decompose tool. Depth maps
   *  to a target note count.
   */
  function buildOnboardingPrompts(a: OnboardingAnswers): {
    systemPrompt: string;
    firstMessage: string;
  } {
    const depthSpec = {
      quick: { count: '3–5', label: 'a quick orientation' },
      moderate: { count: '8–12', label: 'a moderate overview' },
      deep: { count: '15–25', label: 'a deep-dive overview' },
    }[a.depth];
    const expertiseSpec = {
      beginner: 'They are new to this topic — assume no prior vocabulary, define jargon on first use, and prefer concrete examples over abstractions.',
      familiar: 'They have some working familiarity — skip 101 framing but explain non-obvious terms inline.',
      expert: 'They are already deep — pitch the notes at peer level, focus on structure, debates, and frontiers rather than fundamentals.',
    }[a.expertise];
    const useLine = a.use ? `Intended use: ${a.use}.` : 'Intended use: not specified.';
    const systemPrompt =
      `You are kicking off a brand-new thoughtbase for the user. This is their first conversation in this project — the file tree is empty. Your job is to draft ${depthSpec.label} of the subject they named, filed as a single bundle of linked notes the user can review and approve.\n\n` +
      `## Subject\n${a.subject}\n\n` +
      `## Reader\n${expertiseSpec} ${useLine}\n\n` +
      `## Output\nProduce ONE \`propose_notes\` call containing ${depthSpec.count} notes:\n\n` +
      `1. An **index note** at the top level (e.g. \`${slugifyForPath(a.subject)}.md\`) that opens with a 1–3 paragraph orientation and then a bulleted list of wiki-links to each child note. The bullets should be in a sensible reading order (foundations first, then branches).\n` +
      `2. **Child notes** in a folder named after the subject (e.g. \`${slugifyForPath(a.subject)}/<topic>.md\`). Each child stands on its own — a short framing paragraph, then sections sized for the depth level above. Cross-link freely between children where it helps; use \`[[note-name]]\` syntax.\n\n` +
      `Children should partition the subject — overlap is fine where ideas span boundaries, but don't write the same content twice.\n\n` +
      `## Style\n- Markdown body. Use \`#\` for the note title at the top.\n- No frontmatter unless you have a strong reason — keep the surface clean for the user's first encounter.\n- Wiki-links use \`[[note-name]]\` against the bare basename; the system resolves them.\n- Plain prose. Avoid bullet-listing everything; some paragraphs make notes feel like a tour rather than a checklist.\n\n## Process\nIf the subject is ambiguous (e.g. 'Mercury' — planet? element? messenger god?), use \`ask_user\` ONCE to disambiguate before drafting. Otherwise proceed directly. Don't ask the user to review your plan — just produce the bundle. They'll approve or reject the whole thing in the inline review card.`;
    const firstMessage = `Build the overview as instructed.`;
    return { systemPrompt, firstMessage };
  }


  async function handleOnboardingAccept(answers: OnboardingAnswers, dontAskAgain: boolean) {
    showOnboarding = false;
    if (dontAskAgain) {
      try { await api.notebase.setOnboardingDismissed(true); }
      catch (e) { console.warn('[onboarding] persist dismiss failed:', e); }
    }
    const { systemPrompt, firstMessage } = buildOnboardingPrompts(answers);
    await conversationsStore.openConversationTab({
      systemPrompt,
      initialMessage: firstMessage,
      extraTools: ['ask_user'],
    });
  }

  async function handleOnboardingDecline(dontAskAgain: boolean) {
    showOnboarding = false;
    if (dontAskAgain) {
      try { await api.notebase.setOnboardingDismissed(true); }
      catch (e) { console.warn('[onboarding] persist dismiss failed:', e); }
    }
  }

  /**
   * Check whether the just-opened thoughtbase should trigger the
   * onboarding modal. Called from every project-open path (the
   * `project:opened` event AND the in-window New/Open/Open-Recent
   * handlers) — only the new-window paths fire the event, so without
   * this helper "New Thoughtbase" in the current window silently
   * skipped the modal.
   *
   * Idempotent: re-entering on a project that already has notes is a
   * no-op, so callers don't need to guard.
   */
  async function maybeShowOnboarding(): Promise<void> {
    if (countNotes(notebase.files) > 0) return;
    try {
      const dismissed = await api.notebase.getOnboardingDismissed();
      if (!dismissed) showOnboarding = true;
    } catch (e) {
      console.warn('[onboarding] read dismiss flag failed:', e);
    }
  }

  /**
   * Open every note tagged `entrypoint` if the editor came up with no
   * note tabs restored from the saved session. Query/source/saved-query
   * tabs don't suppress — the user's intent for entrypoints is to land
   * them on actual prose, not whatever query they were running last.
   * The graph index may still be warming up the moment a project
   * opens, so the tag query can return empty; we re-query if so.
   *
   * Idempotent: if a note tab is already open the function returns
   * early; if the editor reopens an entrypoint already in the tab list
   * `openFile` is a no-op tab-switch.
   */
  async function maybeOpenEntrypoints(): Promise<void> {
    if (editor.tabs.some((t) => t.type === 'note')) return;
    try {
      const entries = await api.tags.notesByTag(ENTRYPOINT_TAG);
      if (entries.length === 0) return;
      // Sort by title for deterministic active-tab choice. `notesByTag`
      // already sorts but be defensive.
      const sorted = [...entries].sort((a, b) => a.title.localeCompare(b.title));
      // `openFile` resolves activeIndex to the latest tab — open in
      // order, then snap back to index 0 so the first entry is the
      // one the user sees.
      for (const note of sorted) {
        await editor.openFile(note.relativePath);
      }
      // First-entry-active. The list above may include paths that
      // failed to read, but `openFile` only appends when the read
      // succeeds, so index 0 is whichever opened first.
      if (editor.tabs.length > 0) editor.switchTab(0);
    } catch (e) {
      console.warn('[entrypoint] auto-open failed:', e);
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
  const commandDeps: CommandDeps = {
    hasProject: () => !!notebase.meta,
    hasNote: () => !!editor.activeFilePath,
    hasActiveNoteTab: () => editor.activeTab?.type === 'note',
    canGoBack: () => nav.canGoBack,
    canGoForward: () => nav.canGoForward,
    newNote: () => { void handleNewNote(); },
    save: () => { void handleSave(); },
    openProject: () => { void handleOpenThoughtbase(); },
    newProject: () => { void handleNewThoughtbase(); },
    closeProject: () => { notebase.close(); editor.clear(); },
    print: () => window.print(),
    saveAsTemplate: () => { void handleSaveAsTemplate(); },
    insertTemplate: () => { void handleInsertTemplate(); },
    dictate: () => { void toggleEditorDictation(editorComponent?.getView() ?? null); },
    find: () => editorComponent?.openFind(),
    findReplace: () => editorComponent?.openFindReplace(),
    findInNotes: () => { findInNotesMode = 'find'; },
    replaceInNotes: () => { findInNotesMode = 'replace'; },
    gotoLine: () => { showGotoLine = true; },
    sortLines: () => editorComponent?.runSortLines(),
    toggleSidebar: () => { sidebarVisible = !sidebarVisible; },
    toggleRightSidebar: () => { rightSidebarVisible = !rightSidebarVisible; },
    togglePreview: () => cycleViewMode(),
    toggleConversations: () => conversationsStore.toggle(),
    newConversation: () => { void newConversation(); },
    setTheme: (mode) => handleSelectTheme(mode),
    currentTheme: () => themeLabel,
    fontIncrease: () => { editorComponent?.changeFontSize(1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; },
    fontDecrease: () => { editorComponent?.changeFontSize(-1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; },
    fontReset: () => { editorComponent?.resetFontSize(); editorFontSize = 14; },
    quickOpen: () => { void refreshSourcesCache(); void refreshSavedQueriesCache(); showGotoNote = true; },
    navBack: () => { void handleNavBack(); },
    navForward: () => { void handleNavForward(); },
    renameActive: () => { if (editor.activeFilePath) void handleRename(editor.activeFilePath); },
    moveActive: () => { if (editor.activeFilePath) void handleMoveWithPrompt(editor.activeFilePath); },
    copyActive: () => { if (editor.activeFilePath) void handleCopyWithPrompt(editor.activeFilePath); },
    extractSelection: () => { void handleExtractSelection(); },
    splitHere: () => { void handleSplitHere(); },
    splitByHeading: () => { void handleSplitByHeading(); },
    autoTagActive: () => { if (editor.activeFilePath) void handleAutoTag(editor.activeFilePath); },
    autoLinkActive: () => { if (editor.activeFilePath) void handleAutoLink(editor.activeFilePath); },
    autoLinkInboundActive: () => { if (editor.activeFilePath) void handleAutoLinkInbound(editor.activeFilePath); },
    decomposeActive: () => { if (editor.activeFilePath) void handleDecompose(editor.activeFilePath); },
    format: () => { void handleFormat(); },
    ingestUrl: () => { void handleIngestUrlAsSource(); },
    ingestIdentifier: () => { void handleIngestIdentifier(); },
    ingestFile: () => { void handleIngestFileAsSource(); },
    importBibtex: () => { void handleImportBibtex(); },
    importZoteroRdf: () => { void handleImportZoteroRdf(); },
    bibliography: () => { void handleBibliography(); },
    newQuery: () => editor.openQuery(),
    editSavedQueries: () => { showEditSavedQueries = true; },
    openSettings: () => { showSettings = true; },
  };
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
    await api.queries.save(result.scope, result.name, '', tab.query, tab.language);
    tab.title = result.name;
  }

  /**
   * Three-way prompt ("This Window" / "New Window" / "Cancel") wrapped
   * in a promise. Returns 'this' without prompting when no thoughtbase
   * is currently open — same-window is the obviously-right choice for
   * a blank entry screen.
   */
  function askOpenTarget(message: string): Promise<'this' | 'new' | 'cancel'> {
    // App-level shortcut: with no project open there's nothing to open "in a
    // new window vs this one", so skip the prompt. The dialog primitive lives
    // in the dialog store (#670).
    if (!notebase.meta) return Promise.resolve('this');
    return dialogs.askOpenTarget(message);
  }

  async function handleOpenThoughtbase(): Promise<void> {
    const choice = await askOpenTarget('A thoughtbase is already open in this window. Open the next one in:');
    if (choice === 'cancel') return;
    if (choice === 'new') {
      await api.notebase.openInNewWindow();
      return;
    }
    // "This Window" — clear the editor so stale tabs from the previous
    // thoughtbase don't survive into the new one.
    editor.clear();
    const opened = await notebase.open();
    if (opened) {
      await maybeShowOnboarding();
      await maybeOpenEntrypoints();
    }
  }

  async function handleNewThoughtbase(): Promise<void> {
    // Only ask "this window vs. new window" when a thoughtbase is already open —
    // from the welcome screen (nothing open) go straight to the picker (#1036).
    if (notebase.meta) {
      const choice = await askOpenTarget('A thoughtbase is already open in this window. Create the new one in:');
      if (choice === 'cancel') return;
      if (choice === 'new') {
        // New-window path emits `project:opened`, so the onProjectOpened
        // handler in onMount fires maybeShowOnboarding there.
        await api.notebase.newProjectInNewWindow();
        return;
      }
      editor.clear();
    }
    // Guard on the IPC result — a cancelled directory picker leaves
    // the previous project in place; we don't want to re-trigger the
    // onboarding modal on a thoughtbase the user already declined.
    const opened = await notebase.newProject();
    if (opened) {
      await maybeShowOnboarding();
      await maybeOpenEntrypoints();
    }
  }

  async function handleOpenRecentThoughtbase(rootPath: string): Promise<void> {
    const choice = await askOpenTarget('A thoughtbase is already open in this window. Open the recent one in:');
    if (choice === 'cancel') return;
    if (choice === 'new') {
      await api.notebase.openPathInNewWindow(rootPath);
      return;
    }
    editor.clear();
    const opened = await notebase.openPath(rootPath);
    if (opened) {
      await maybeShowOnboarding();
      await maybeOpenEntrypoints();
    }
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
  };
  const {
    handleNewNote, handleNewFolder, handleDelete, openFirstReferenceFromSafeDelete,
    handleCut, handleCopy, handleMove, handlePaste, handleMerge, performMerge,
    handleRename, handleCopyWithPrompt, handleMoveWithPrompt,
  } = createNoteOps(noteOpsCtx);

  // Nav-ops + source-view-ops handler cluster (#670): position history
  // (back/forward), file / wiki-link navigation, and the source *view* handlers
  // (open source / PDF / excerpt, show-markdown, source-deleted). Lives in
  // ./lib/app/nav-view.ts; no feature-state store. Destructured into the same
  // names so every call site reads unchanged. Placed before createSourceOps so
  // handleOpenSource is in scope for the sourceOpsCtx.openSource getter. The
  // module reads / writes pending search + preview anchor, view mode, and the
  // alias map via ctx — those `$state` decls stay in App.
  const {
    recordCurrentPosition, handleNavBack, handleNavForward, handleFileSelect, handleNavigate, handleOpenAtOffset,
    handleSourceDeleted, handleOpenSource, handleOpenPdf, handleShowMarkdownFromPdf, handleOpenExcerpt,
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
    handleAddTag, handleRemoveTag, handleToggleEntrypoint,
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

  // Refresh tags when notebase opens
  const originalOpen = notebase.open;
  notebase.open = async () => {
    const result = await originalOpen();
    setTimeout(() => {
      sidebar?.refreshTags();
      sidebar?.refreshSources();
      sidebar?.refreshTables();
      void refreshSourcesCache();
    }, 100);
    return result;
  };

  // Main broadcasts when the sources watcher reindexes or removes a source.
  // Refresh the sidebar Sources panel AND the editor autocomplete cache so
  // newly-ingested sources become reachable without a manual reload.
  api.sources.onChanged(() => {
    sidebar?.refreshSources();
    void refreshSourcesCache();
  });

  // Main broadcasts after the initial CSV scan and on every register/unregister
  // from the watcher — keeps the sidebar Tables panel in lockstep.
  api.tables.onChanged(() => {
    sidebar?.refreshTables();
  });

  // Semantic-index backfill progress (#836): a quiet status-bar indicator while
  // the corpus embeds in the background. Cleared on completion (running:false).
  api.embeddings.onBackfillProgress((p) => {
    embeddingProgress = p.running && p.total > 0 ? { done: p.done, total: p.total } : null;
  });

  // CSV table-name collision (#354): two CSVs would land on the
  // same DuckDB table name; the second was skipped. Show a
  // suppressible toast pointing at `table_name:` as the fix.
  api.tables.onNameCollision((collision) => {
    void showConfirm(
      `Two CSVs would use the same DuckDB table name "${collision.tableName}":\n\n` +
      `  • ${collision.existingPath}  (active)\n` +
      `  • ${collision.attemptedPath}  (skipped)\n\n` +
      `Add \`table_name: <unique-name>\` to a companion .md alongside one of them to disambiguate.`,
      CONFIRM_KEYS.tableNameCollision,
      'OK',
      { hideDontAskAgain: false },
    );
  });

  function cycleViewMode() {
    editor.cycleViewMode();
  }

  // Global keyboard shortcuts live in lib/keymap/handle-keydown.ts (#670);
  // this object injects the state predicates + actions they dispatch to.
  const keymapDeps: KeymapDeps = {
    hasProject: () => !!notebase.meta,
    hasActiveTab: () => !!editor.activeTab,
    hasActiveIndex: () => editor.activeIndex >= 0,
    toggleCommandPalette: () => { showCommandPalette = !showCommandPalette; },
    navBack: () => { void handleNavBack(); },
    navForward: () => { void handleNavForward(); },
    cyclePreview: () => cycleViewMode(),
    toggleRightSidebar: () => { rightSidebarVisible = !rightSidebarVisible; },
    cycleTheme: () => handleCycleTheme(),
    newNote: () => { void handleNewNote(); },
    closeActiveTab: () => { editor.closeTab(editor.activeIndex); },
    toggleQuickOpen: () => { showGotoNote = !showGotoNote; },
    openGotoLine: () => { showGotoLine = true; },
    newQuery: () => editor.openQuery(),
    openConversation: () => { void openConversation(); },
  };

  onMount(() => {
    initTheme();
    // Tell main the current theme so the native View → Theme radio starts
    // in sync with what the renderer loaded from localStorage (#1139).
    api.menu.reportTheme(themeLabel);
    initAppearance();

    // Pull skill metadata loaded by main (#625) into the renderer registry so
    // the tool panel / command palette / slash commands see skills alongside
    // hardcoded tools. Fire-and-forget — skills enrich the menus when ready.
    void (async () => {
      try {
        const cat = await api.skills.list();
        // Apply the per-machine menu config (#630): only enabled skills, in
        // their effective menu and configured order, reach the palette / slash.
        registerSkillInfos(applyMenuConfig(cat.skills, cat.config));
      } catch (err) {
        console.warn('[skills] failed to load skill list:', err);
      }
    })();

    // Auto-save
    editor.onAutoSaved = () => {
      sidebar?.refreshTags();
      rightSidebar?.refresh();
      graphRevision++;
      void refreshBacklinkCount();
      void refreshAliasMap();
    };
    window.addEventListener('beforeunload', () => {
      // Capture current editor state before persisting — the Editor
      // only saves on unmount, which hasn't happened yet on window close
      if (editor.activeFilePath && editorComponent) {
        editor.saveEditorState(
          editor.activeFilePath,
          editorComponent.getOffset(),
          editorComponent.getView()?.scrollDOM.scrollTop ?? 0,
        );
      }
      editor.flushAutoSave();
      editor.persistTabs();
    });

    // Listen for menu events from main process
    api.menu.onNewNote(() => handleNewNote());
    api.menu.onSave(() => handleSave());
    api.menu.onSaveAsTemplate(() => { void handleSaveAsTemplate(); });
    api.menu.onInsertTemplate(() => { void handleInsertTemplate(); });
    api.menu.onCycleTheme(() => handleCycleTheme());
    api.menu.onSetTheme((mode) => handleSelectTheme(mode));
    api.menu.onFontIncrease(() => { editorComponent?.changeFontSize(1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; });
    api.menu.onFontDecrease(() => { editorComponent?.changeFontSize(-1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; });
    api.menu.onFontReset(() => { editorComponent?.resetFontSize(); editorFontSize = 14; });
    api.menu.onToggleSidebar(() => { sidebarVisible = !sidebarVisible; });
    api.menu.onToggleRightSidebar(() => { rightSidebarVisible = !rightSidebarVisible; });
    api.menu.onToggleConversations(() => conversationsStore.toggle());
    api.menu.onNewConversation(() => { void newConversation(); });
    api.menu.onTogglePreview(() => cycleViewMode());
    // Editor split — pane focus & layout commands (#814).
    api.menu.onSplitRight(() => editor.splitGroup(editor.activeGroupId, 'horizontal'));
    api.menu.onSplitDown(() => editor.splitGroup(editor.activeGroupId, 'vertical'));
    api.menu.onFocusNextGroup(() => editor.focusNextGroup());
    api.menu.onFocusPrevGroup(() => editor.focusPreviousGroup());
    api.menu.onCloseGroup(() => editor.closeActiveGroup());
    api.menu.onOpenProject(() => handleOpenThoughtbase());
    api.menu.onNewProject(() => handleNewThoughtbase());
    api.menu.onOpenRecentProject((p) => handleOpenRecentThoughtbase(p));
    api.menu.onCloseProject(() => {
      notebase.close();
      editor.clear();
    });
    api.menu.onClearRecent(() => api.notebase.clearRecent());
    api.menu.onNavBack(() => handleNavBack());
    api.menu.onNavForward(() => handleNavForward());
    api.menu.onGotoLine(() => { if (editor.activeTab) showGotoLine = true; });
    api.menu.onQuickOpen(() => {
      // Lazily refresh the palette's source + query backing data so
      // its scope chip counts are fresh when the user opens it.
      void refreshSourcesCache();
      void refreshSavedQueriesCache();
      showGotoNote = true;
    });
    api.menu.onNewQuery(() => editor.openQuery());
    api.menu.onOpenStockQuery(({ query, language }) => editor.openQuery(query, language));
    api.menu.onEditSavedQueries(() => { showEditSavedQueries = true; });
    api.menu.onSortLines(() => editorComponent?.runSortLines());
    api.menu.onFind(() => editorComponent?.openFind());
    api.menu.onFindReplace(() => editorComponent?.openFindReplace());
    api.menu.onFindInNotes(() => { findInNotesMode = 'find'; });
    api.menu.onReplaceInNotes(() => { findInNotesMode = 'replace'; });
    api.menu.onPrint(() => window.print());
    api.menu.onAbout(() => { showAbout = true; });
    api.menu.onShortcuts(() => { showShortcuts = true; });
    api.menu.onOpenInDefault(() => { if (editor.activeFilePath) void api.shell.openInDefault(editor.activeFilePath); });
    api.menu.onOpenInTerminal(() => { void api.shell.openInTerminal(editor.activeFilePath ?? undefined); });
    api.menu.onOpenSettings(() => { showSettings = true; });

    // Refactor menu (issue #172)
    api.menu.onRefactorRename(() => { if (editor.activeFilePath) void handleRename(editor.activeFilePath); });
    api.menu.onRefactorMove(() => { if (editor.activeFilePath) void handleMoveWithPrompt(editor.activeFilePath); });
    api.menu.onRefactorCopy(() => { if (editor.activeFilePath) void handleCopyWithPrompt(editor.activeFilePath); });
    api.menu.onRefactorExtract(() => handleExtractSelection());
    api.menu.onRefactorSplitHere(() => handleSplitHere());
    api.menu.onRefactorSplitByHeading(() => handleSplitByHeading());
    api.menu.onRefactorAutoTag(() => { if (editor.activeFilePath) void handleAutoTag(editor.activeFilePath); });
    api.menu.onRefactorAutoLink(() => { if (editor.activeFilePath) void handleAutoLink(editor.activeFilePath); });
    api.menu.onRefactorAutoLinkInbound(() => { if (editor.activeFilePath) void handleAutoLinkInbound(editor.activeFilePath); });
    api.menu.onRefactorDecompose(() => { if (editor.activeFilePath) void handleDecompose(editor.activeFilePath); });

    // Format menu (issue #153)
    api.menu.onFormat(() => handleFormat());

    // Insert/Update Bibliography (#113)
    api.menu.onBibliography(() => { void handleBibliography(); });

    // Ingest URL (#93)
    api.menu.onIngestUrl(() => handleIngestUrlAsSource());
    api.menu.onIngestIdentifier(() => handleIngestIdentifier());
    api.menu.onIngestFile(() => handleIngestFileAsSource());
    api.menu.onImportBibtex(() => handleImportBibtex());
    api.menu.onImportZoteroRdf(() => handleImportZoteroRdf());
    api.menu.onExport((groupId) => { exportDialogGroup = groupId; });
    api.menu.onPublish(() => { publishDialogOpen = true; });

    // Progress updates during a bulk import — rewrites the busy-overlay
    // label in place so the user sees running counts on large imports.
    // One handler per stream; both funnel into the same busyLabel so the
    // user doesn't care which import is running.
    const progressToBusyLabel = ({ done, total, currentTitle }: { done: number; total: number; currentTitle: string }) => {
      if (busy.label) {
        const short = currentTitle.length > 60 ? currentTitle.slice(0, 57) + '…' : currentTitle;
        busy.setLabel(`Importing ${done}/${total}: ${short}`);
      }
    };
    api.sources.onImportBibtexProgress(progressToBusyLabel);
    api.sources.onImportZoteroRdfProgress(progressToBusyLabel);

    // External file changes (watcher-driven) — refresh the sidebar so files
    // added / deleted in Finder show up without a restart. Debounced because
    // the watcher also fires for internal ops that already called refresh(),
    // and a burst of watcher events (e.g. ingesting a source tree) shouldn't
    // produce a burst of listFiles round-trips.
    let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleTreeRefresh = () => {
      if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
      treeRefreshTimer = setTimeout(() => {
        treeRefreshTimer = null;
        void notebase.refresh();
      }, 200);
    };
    api.notebase.onFileCreated(scheduleTreeRefresh);
    api.notebase.onFileDeleted((deletedPath) => {
      editor.closeTabsForDeletedPath(deletedPath);
      scheduleTreeRefresh();
    });

    // Notebase rename/rewrite notifications from main — keep open tabs
    // consistent with disk so the next auto-save doesn't overwrite a
    // link rewrite silently.
    api.notebase.onRenamed((transitions) => {
      editor.applyRenameTransitions(transitions);
      bookmarkStore.applyRenameTransitions(transitions);
    });
    api.notebase.onRewritten(async (paths) => {
      for (const p of paths) {
        if (editor.isPathDirty(p)) {
          const keepDisk = await showConfirm(
            `"${p}" was updated on disk by a link rewrite. Discard your unsaved edits and load the new version?`,
            CONFIRM_KEYS.rewriteConflict,
            'Load disk',
          );
          if (!keepDisk) continue;
        }
        await editor.reloadTabFromDisk(p);
      }
    });

    api.notebase.onHeadingRenameSuggested(async (candidate) => {
      // Keep the user's own section bookmarks pointing at the renamed
      // heading (#755). Local metadata, no content mutation — do it
      // unconditionally, even when nothing links to the heading.
      bookmarkStore.retargetSectionAnchor(candidate.relativePath, candidate.oldSlug, candidate.newSlug);
      // Only offer to rewrite OTHER notes' incoming links when some exist.
      const n = candidate.incomingLinkCount;
      if (n === 0) return;
      const msg =
        `The heading "${candidate.oldText}" in ${candidate.relativePath} looks like it was renamed ` +
        `to "${candidate.newText}". Update ${n} incoming link${n === 1 ? '' : 's'}?`;
      const ok = await showConfirm(msg, CONFIRM_KEYS.headingRenameSuggestion, 'Update links');
      if (!ok) return;
      await api.notebase.renameAnchor(candidate.relativePath, candidate.oldSlug, candidate.newSlug);
    });

    // Tools for Thought — stream listener (once)
    api.tools.onStream((chunk) => {
      toolPanel.appendChunk(chunk);
    });

    api.tools.onInvoke((toolId) => handleToolInvoke(toolId));

    api.menu.onProjectOpened(async (meta) => {
      await notebase.openPath(meta.rootPath);
      await editor.restoreTabs();
      await bookmarkStore.load();
      await loadFormatSettings();
      sidebar?.refreshTags();
      sidebar?.refreshSources();
      sidebar?.refreshTables();
      await refreshSourcesCache();
      await refreshAliasMap();
      // Inspections hidden for v1.0: count polling disabled so the status-bar
      // badge stays hidden (inspectionCount stays 0). Restore the
      // setTimeout/setInterval(refreshInspectionCount) to re-enable.
      // Restore cursor/scroll for every pane's active note tab after the
      // split layout has rendered and each pane's Editor has mounted (#816 —
      // restore is now multi-group, not just the focused pane).
      await tick();
      requestAnimationFrame(() => {
        for (const grp of editor.groups) {
          const noteTab = editor.noteTabForGroup(grp.id);
          if (noteTab?.cursorOffset != null) {
            editorComponents[grp.id]?.restorePosition(noteTab.cursorOffset, noteTab.scrollTop);
          }
        }
      });

      // Offer the onboarding journey on empty thoughtbases. Files have
      // already been loaded by `notebase.openPath` above, so the count
      // is current. Helper is shared with the in-window New/Open paths.
      await maybeShowOnboarding();
      // Auto-open any `entrypoint`-tagged notes when restoreTabs left
      // the editor with no note tabs. Runs after the onboarding check
      // because an empty thoughtbase has no entrypoints anyway, but
      // ordering doesn't matter beyond that.
      await maybeOpenEntrypoints();
    });
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
          onRemoveTag={handleRemoveTag}
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
          onSourceDeleted={handleSourceDeleted}
          onShowConfirm={showConfirm}
          onShowPrompt={showPrompt}
          onMineReferences={handleMineReferences}
          onTableClick={(name) => editor.openQuery(`SELECT * FROM ${name}`, 'sql')}
          onOpenCsv={(rel) => handleFileSelect(rel)}
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
                          onToolInvoke={handleToolInvoke}
                          onOpenConversation={openConversation}
                          onNavigate={handleNavigate}
                          onOpenSource={handleOpenSource}
                          onOpenExcerpt={handleOpenExcerpt}
                          getNotePaths={() => flattenNotePaths(notebase.files)}
                          getSources={() => sourcesCache}
                          getAliases={() => aliasEntries}
                          onBookmark={() => bookmarkStore.add(note.fileName.replace(/\.(md|ttl|csv)$/, ''), note.relativePath)}
                          onBookmarkSection={() => { void handleBookmarkSection(); }}
                          onBookmarkLine={handleBookmarkLine}
                          bookmarks={collectBookmarksForPath(bookmarkStore.tree, note.relativePath)}
                          onExtractSelection={handleExtractSelection}
                          onSplitHere={handleSplitHere}
                          onSplitByHeading={handleSplitByHeading}
                          onRename={() => void handleRename(note.relativePath)}
                          onMove={() => void handleMoveWithPrompt(note.relativePath)}
                          onCopyFile={() => void handleCopyWithPrompt(note.relativePath)}
                          onMerge={() => handleMerge(note.relativePath)}
                          onAutoTag={() => void handleAutoTag(note.relativePath)}
                          onAutoLink={() => void handleAutoLink(note.relativePath)}
                          onAutoLinkInbound={() => void handleAutoLinkInbound(note.relativePath)}
                          onFormatCurrentNote={() => handleFormat()}
                          onUploadError={(message) => {
                            void showConfirm(message, CONFIRM_KEYS.imageUploadFailed, 'OK');
                          }}
                          onRunCell={(language, code, notePath) =>
                            runCellWithTrust(language, code, notePath, { showConfirm })
                          }
                          onInsertQueryList={async () => {
                            const tag = await showPrompt('Tag name:');
                            if (!tag) return;
                            const block = `\n:::query-list\nSELECT ?title ?path WHERE {\n  ?note minerva:hasTag ?t .\n  ?t minerva:tagName "${tag}" .\n  ?note dc:title ?title .\n  ?note minerva:relativePath ?path .\n} ORDER BY ?title\n:::\n`;
                            editorComponents[groupId]?.insertText(block);
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
                        {numberedHeadings}
                        getNotePaths={() => flattenNotePaths(notebase.files)}
                        getAliases={() => aliasEntries}
                        revision={graphRevision}
                        onNavigate={handleNavigate}
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
                          runCellWithTrust(language, code, notePath, { showConfirm })
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
                  <p>Select a note from the sidebar</p>
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
          />
          <ToolPanel
            bind:this={toolPanelComponent}
            onNoteCreated={() => { void notebase.refresh(); sidebar?.refreshTags(); }}
            onOpenConversation={handleOpenConversationFromTool}
            onMissingApiKey={() => { void handleMissingApiKey(); }}
          />
        {/if}
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
      onJumpTo={async (rel, line, col) => {
        await editor.openFile(rel);
        requestAnimationFrame(() => editorComponent?.gotoLineColumn(line, col + 1));
      }}
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
        const pathPreview = result.writtenPaths.slice(0, 5).map((p) => `  • ${p}`).join('\n');
        const more = result.writtenPaths.length > 5
          ? `\n  …and ${result.writtenPaths.length - 5} more`
          : '';
        await showConfirm(
          `${result.summary}\n\nFiles written:\n${pathPreview}${more}`,
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
    z-index: 3000;
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
    z-index: 3000;
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
