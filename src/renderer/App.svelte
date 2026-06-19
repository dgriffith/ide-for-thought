<script lang="ts">
  import TitleBar from './lib/components/TitleBar.svelte';
  import TabBar from './lib/components/TabBar.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Editor from './lib/components/Editor.svelte';
  import QueryPanel from './lib/components/QueryPanel.svelte';
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
  import { handleKeydown, type KeymapDeps } from './lib/keymap/handle-keydown';
  import ExportDialog from './lib/components/ExportDialog.svelte';
  import GotoLineDialog from './lib/components/GotoLineDialog.svelte';
  import EditSavedQueriesDialog from './lib/components/EditSavedQueriesDialog.svelte';
  import SaveQueryDialog from './lib/components/SaveQueryDialog.svelte';
  import FindInNotesDialog from './lib/components/FindInNotesDialog.svelte';
  import GotoNoteDialog from './lib/components/GotoNoteDialog.svelte';
  import ToolPanel from './lib/components/ToolPanel.svelte';
  import ConversationsPanel from './lib/components/ConversationsPanel.svelte';
  import AutoLinkDialog from './lib/components/AutoLinkDialog.svelte';
  import AutoLinkInboundDialog from './lib/components/AutoLinkInboundDialog.svelte';
  import BusyOverlay from './lib/components/BusyOverlay.svelte';
  import CsvTable from './lib/components/CsvTable.svelte';
  import SettingsDialog from './lib/components/SettingsDialog.svelte';
  import OnboardingDialog from './lib/components/OnboardingDialog.svelte';
  import type { OnboardingAnswers } from './lib/components/OnboardingDialog.svelte';
  import { api } from './lib/ipc/client';
  import { getNavigationStore } from './lib/stores/navigation.svelte';
  import { initTheme, cycleTheme, getThemeMode } from './lib/theme';
  import {
    slugifyForPath,
    flattenNotePaths,
    countNotes,
  } from './lib/app/text-helpers';
  import { initAppearance } from './lib/appearance/settings';
  import { getToolPanelStore } from './lib/stores/tool-panel.svelte';
  import { getConversationsStore } from './lib/stores/conversations.svelte';
  import { getBookmarksStore } from './lib/stores/bookmarks.svelte';
  import { CONFIRM_KEYS } from './lib/confirm-keys';
  import { isMissingApiKeyError } from '../shared/llm-errors';
  import { ENTRYPOINT_TAG } from '../shared/entrypoint';
  import { runCellWithTrust } from './lib/compute/run-cell-with-trust';
  import { loadFormatSettings } from './lib/formatter/settings';
  import { toggleTaskOnLine } from './lib/editor/task-toggle';
  import { registerSkillInfos } from './lib/tools/tool-registry';
  import { applyMenuConfig } from '../shared/skills/menu-config';

  type ViewMode = 'source' | 'preview' | 'split';

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

  let inspectionCount = $state(0);
  let backlinkCount = $state(0);
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

  async function refreshInspectionCount() {
    const results = await api.graph.inspections();
    inspectionCount = (results as unknown[]).length;
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
  let viewMode = $state<ViewMode>('source');
  let sidebarVisible = $state(true);
  let sidebar = $state<Sidebar>();
  let rightSidebar = $state<RightSidebar>();
  let rightSidebarVisible = $state(false);
  let editorComponent = $state<Editor>();
  let queryPanelComponent = $state<QueryPanel>();
  let previewComponent = $state<Preview>();
  let toolPanelComponent = $state<ToolPanel>();
  let cursorInfo = $state<CursorInfo>({ line: 1, column: 1, selectionLength: 0, wordCount: 0 });

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
  // Generic modal dialogs (prompt / confirm / new-note / snippet / open-target)
  // live in the dialog store (#670); destructure the imperative `show*` helpers
  // so the many call sites read unchanged. <DialogHost> renders the state.
  const dialogs = getDialogStore();
  const { showPrompt, showConfirm } = dialogs;
  let exportDialogFor = $state<string | null>(null);

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
    cycleTheme: () => handleCycleTheme(),
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
  const commands = $derived<Command[]>(buildCommandRegistry(commandDeps));
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
    const choice = await askOpenTarget('A thoughtbase is already open in this window. Create the new one in:');
    if (choice === 'cancel') return;
    if (choice === 'new') {
      // New-window path emits `project:opened`, so the onProjectOpened
      // handler in onMount fires maybeShowOnboarding there.
      await api.notebase.newProjectInNewWindow();
      return;
    }
    editor.clear();
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
    recordCurrentPosition, handleNavBack, handleNavForward, handleFileSelect, handleNavigate,
    handleSourceDeleted, handleOpenSource, handleOpenPdf, handleShowMarkdownFromPdf, handleOpenExcerpt,
  } = createNavView({
    getEditorComponent: () => editorComponent,
    setPendingSearchQuery: (s) => { pendingSearchQuery = s; },
    setPendingPreviewAnchor: (s) => { pendingPreviewAnchor = s; },
    getViewMode: () => viewMode,
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
    handleFormat, handleBibliography, handleAutoTag,
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
  // (#244), decompose / crystallize (#515), the freeform / message / from-tool
  // conversation openers, and generic tool invocation. Lives in
  // ./lib/app/conversation-ops.ts. Placed after createNavView so handleFileSelect
  // is in scope for the openFileSelect getter; reaches the editor view + tool-
  // panel component via ctx. The conversationsStore / toolPanel store handles
  // stay in App (onMount streaming still uses them).
  const {
    handleSaveCellOutput, handleDecompose, handleCrystallize,
    openConversation, newConversation, openConversationWithMessage, handleOpenConversationFromTool, handleToolInvoke,
  } = createConversationOps({
    getEditorView: () => editorComponent?.getView(),
    getToolPanelComponent: () => toolPanelComponent,
    openFileSelect: (p) => { void handleFileSelect(p); },
  } satisfies ConversationOpsCtx);

  function handleCycleTheme() {
    themeLabel = cycleTheme();
    editorComponent?.updateTheme();
    queryPanelComponent?.updateTheme();
    previewComponent?.updateTheme();
  }

  async function handleSwitchTab(index: number) {
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
    void api.shell.revealFile(relativePath);
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
    if (viewMode === 'source') viewMode = 'preview';
    else if (viewMode === 'preview') viewMode = 'split';
    else viewMode = 'source';
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
    api.menu.onFontIncrease(() => { editorComponent?.changeFontSize(1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; });
    api.menu.onFontDecrease(() => { editorComponent?.changeFontSize(-1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; });
    api.menu.onFontReset(() => { editorComponent?.resetFontSize(); editorFontSize = 14; });
    api.menu.onToggleSidebar(() => { sidebarVisible = !sidebarVisible; });
    api.menu.onToggleRightSidebar(() => { rightSidebarVisible = !rightSidebarVisible; });
    api.menu.onToggleConversations(() => conversationsStore.toggle());
    api.menu.onNewConversation(() => { void newConversation(); });
    api.menu.onTogglePreview(() => cycleViewMode());
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
    api.menu.onExport((id) => { exportDialogFor = id; });

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
      const n = candidate.incomingLinkCount;
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
      // Load inspection count after a brief delay to let health checks finish
      setTimeout(refreshInspectionCount, 3000);
      // Refresh periodically
      setInterval(refreshInspectionCount, 60000);
      // Restore position for the active tab after tabs are rendered
      const activeTab = editor.activeNoteTab;
      if (activeTab?.cursorOffset != null) {
        await tick();
        requestAnimationFrame(() => {
          editorComponent?.restorePosition(activeTab.cursorOffset!, activeTab.scrollTop);
        });
      }

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
        {#if editor.tabs.length > 0}
          <TabBar
            tabs={editor.tabs}
            activeIndex={editor.activeIndex}
            sources={sourcesCache}
            onSwitch={handleSwitchTab}
            onClose={editor.closeTab}
            onCloseOthers={editor.closeOthers}
            onCloseAll={editor.closeAll}
            onReveal={handleRevealInSidebar}
            onOpenConversation={openConversation}
            onBookmark={(path) => bookmarkStore.add(path.split('/').pop()?.replace(/\.(md|ttl|csv)$/, '') ?? path, path)}
            onNewTab={() => handleNewNote()}
          />
        {/if}
        {#if editor.activeTab?.type === 'note'}
          <BreadcrumbsBar
            filePath={editor.activeFilePath}
            content={editor.activeTab.content}
            cursorLine={cursorInfo.line}
            showHeadings={breadcrumbsSettings.showHeadingChain}
            onRevealFolder={(folder) => { void sidebar?.revealFolder(folder); }}
            onScrollToLine={(line) => editorComponent?.gotoLineColumn(line, 1)}
          />
        {/if}
        {#if editor.activeTab?.type === 'note' && editor.activeTab.relativePath.endsWith('.csv')}
          <CsvTable
            relativePath={editor.activeTab.relativePath}
            content={editor.activeTab.content}
          />
        {:else if editor.activeTab?.type === 'note'}
          <div class="toolbar">
            <div class="view-toggle">
              <button
                class:active={viewMode === 'source'}
                onclick={() => viewMode = 'source'}
                title="Source (Cmd+Shift+P to cycle)"
              >Source</button>
              <button
                class:active={viewMode === 'split'}
                onclick={() => viewMode = 'split'}
                title="Split view"
              >Split</button>
              <button
                class:active={viewMode === 'preview'}
                onclick={() => viewMode = 'preview'}
                title="Preview"
              >Preview</button>
            </div>
            <button
              class="nav-btn sidebar-toggle"
              class:active={rightSidebarVisible}
              onclick={() => { rightSidebarVisible = !rightSidebarVisible; }}
              title="Toggle Right Sidebar (Cmd+Shift+B)"
            ><Icon name="outline" size={12} /></button>
          </div>
          <div class="editor-content" class:split={viewMode === 'split'}>
            {#if viewMode === 'source' || viewMode === 'split'}
              <div class="editor-panel">
                {#key editor.activeFilePath}
                  <Editor
                    bind:this={editorComponent}
                    filePath={editor.activeFilePath!}
                    content={editor.content}
                    initialHistory={editor.activeNoteTab?.historyJson}
                    searchQuery={pendingSearchQuery}
                    onContentChange={editor.setContent}
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
                    onBookmark={() => { if (editor.activeFilePath) bookmarkStore.add(editor.activeFileName.replace(/\.(md|ttl|csv)$/, ''), editor.activeFilePath, editorComponent?.getOffset()); }}
                    onExtractSelection={handleExtractSelection}
                    onSplitHere={handleSplitHere}
                    onSplitByHeading={handleSplitByHeading}
                    onRename={() => { if (editor.activeFilePath) void handleRename(editor.activeFilePath); }}
                    onMove={() => { if (editor.activeFilePath) void handleMoveWithPrompt(editor.activeFilePath); }}
                    onCopyFile={() => { if (editor.activeFilePath) void handleCopyWithPrompt(editor.activeFilePath); }}
                    onMerge={() => { if (editor.activeFilePath) handleMerge(editor.activeFilePath); }}
                    onAutoTag={() => { if (editor.activeFilePath) void handleAutoTag(editor.activeFilePath); }}
                    onAutoLink={() => { if (editor.activeFilePath) void handleAutoLink(editor.activeFilePath); }}
                    onAutoLinkInbound={() => { if (editor.activeFilePath) void handleAutoLinkInbound(editor.activeFilePath); }}
                    onDecompose={() => { if (editor.activeFilePath) void handleDecompose(editor.activeFilePath); }}
                    onCrystallize={() => { if (editor.activeFilePath) void handleCrystallize(editor.activeFilePath); }}
                    onFormatCurrentNote={() => handleFormat()}
                    onUploadError={(message) => {
                      // Image-upload rejection (#455). Surface via the
                      // existing confirm dialog with a dismissable key —
                      // user-facing but not blocking.
                      void showConfirm(message, CONFIRM_KEYS.imageUploadFailed, 'OK');
                    }}
                    onRunCell={(language, code, notePath) =>
                      runCellWithTrust(language, code, notePath, { showConfirm })
                    }
                    onInsertQueryList={async () => {
                      const tag = await showPrompt('Tag name:');
                      if (!tag) return;
                      const block = `\n:::query-list\nSELECT ?title ?path WHERE {\n  ?note minerva:hasTag ?t .\n  ?t minerva:tagName "${tag}" .\n  ?note dc:title ?title .\n  ?note minerva:relativePath ?path .\n} ORDER BY ?title\n:::\n`;
                      editorComponent?.insertText(block);
                    }}
                  />
                {/key}
              </div>
            {/if}
            {#if viewMode === 'preview' || viewMode === 'split'}
              <div class="preview-panel">
                <Preview
                  bind:this={previewComponent}
                  content={editor.content}
                  notePath={editor.activeFilePath}
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
                  onBookmark={() => { if (editor.activeFilePath) bookmarkStore.add(editor.activeFileName.replace(/\.(md|ttl|csv)$/, ''), editor.activeFilePath); }}
                  onRunCell={(language, code, notePath) =>
                    runCellWithTrust(language, code, notePath, { showConfirm })
                  }
                  onApplyCellOutputEdit={(newContent) => { editor.setContent(newContent); }}
                />
              </div>
            {/if}
          </div>
          <StatusBar
            cursor={cursorInfo}
            fontSize={editorFontSize}
            theme={themeLabel}
            {inspectionCount}
            {backlinkCount}
            isDirty={editor.isDirty}
            hasActiveNote={editor.activeTab?.type === 'note'}
            onGotoLine={() => { showGotoLine = true; }}
            onCycleTheme={handleCycleTheme}
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
        {:else if editor.activeTab?.type === 'query'}
          <QueryPanel
            bind:this={queryPanelComponent}
            tab={editor.activeQueryTab!}
            onQueryChange={editor.setQueryText}
            onLanguageChange={editor.setQueryLanguage}
            onExecute={editor.executeQuery}
            onSave={handleSaveQuery}
          />
        {:else if editor.activeTab?.type === 'source'}
          {#key editor.activeTab.sourceId}
            <SourceDetail
              sourceId={editor.activeTab.sourceId}
              highlightExcerptId={editor.activeTab.highlightExcerptId}
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
        {:else if editor.activeTab?.type === 'pdf'}
          {#key editor.activeTab.sourceId}
            <!-- Lazy: pdfjs-dist only loads when a PDF tab is opened, keeping it
                 out of the eager startup graph (#691). -->
            {#await import('./lib/components/PdfViewer.svelte') then { default: PdfViewer }}
              <PdfViewer
                sourceId={editor.activeTab.sourceId}
                initialPage={editor.activeTab.page}
                onShowMarkdown={handleShowMarkdownFromPdf}
              />
            {/await}
          {/key}
        {:else}
          <div class="no-file">
            <p>Select a note from the sidebar</p>
          </div>
        {/if}
      </div>
      {#if rightSidebarVisible && editor.activeTab?.type === 'note'}
        <RightSidebar
          bind:this={rightSidebar}
          activeFilePath={editor.activeFilePath}
          content={editor.content}
          onFileSelect={handleFileSelect}
          onNavigate={handleNavigate}
          onScrollToLine={(line) => editorComponent?.gotoLineColumn(line, 1)}
          onOpenConversation={(msg) => { void openConversationWithMessage(msg); }}
          onOpenQuery={(sql) => editor.openQuery(sql, 'sql')}
          onOpenSource={handleOpenSource}
          onOpenExcerpt={handleOpenExcerpt}
          onContentChange={editor.setContent}
        />
      {/if}
    {:else}
      <div class="welcome">
        <h1>Minerva</h1>
        <p>An integrated knowledge management environment</p>
        <button onclick={notebase.open}>Open Thoughtbase</button>
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
  {#if exportDialogFor}
    <ExportDialog
      exporterId={exportDialogFor}
      activeFilePath={editor.activeFilePath}
      onCancel={() => { exportDialogFor = null; }}
      onExported={async (result) => {
        exportDialogFor = null;
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
  {#if busy.label}
    <BusyOverlay label={busy.label} />
  {/if}
  {#if showSettings}
    <SettingsDialog
      onApplyEditor={(s) => editorComponent?.applySettings(s)}
      onThemeChanged={() => {
        themeLabel = getThemeMode();
        editorComponent?.updateTheme();
        queryPanelComponent?.updateTheme();
        previewComponent?.updateTheme();
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

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .sidebar-toggle {
    margin-left: auto;
  }

  .sidebar-toggle.active {
    color: var(--accent);
  }

  .view-toggle {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
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

  .editor-content.split {
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
</style>
