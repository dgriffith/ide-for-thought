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
  import { flattenNoteFiles, resolveWikiLinkTarget } from './lib/wiki-link-resolver';
  import { expandSelectionToNoteFiles, resolveSelectionTargets, pathExistsInTree } from './lib/sidebar-tree-utils';
  import {
    mergeTagsIntoContent,
    removeTagsFromContent,
    extractTagsFromContent,
  } from '../shared/refactor/auto-tag';
  import { getEditorStore } from './lib/stores/editor.svelte';
  import PromptDialog from './lib/components/PromptDialog.svelte';
  import MineReferencesDialog from './lib/components/MineReferencesDialog.svelte';
  import ResolveStubDialog from './lib/components/ResolveStubDialog.svelte';
  import { RESOLVE_AUTO_THRESHOLD } from '../shared/resolve-stub';
  import CommandPaletteDialog from './lib/components/CommandPaletteDialog.svelte';
  import type { Command } from './lib/command-palette/types';
  import { formatAccelerator } from './lib/command-palette/format-accelerator';
  import ConfirmDialog from './lib/components/ConfirmDialog.svelte';
  import ExportDialog from './lib/components/ExportDialog.svelte';
  import OpenTargetDialog from './lib/components/OpenTargetDialog.svelte';
  import GotoLineDialog from './lib/components/GotoLineDialog.svelte';
  import EditSavedQueriesDialog from './lib/components/EditSavedQueriesDialog.svelte';
  import SaveQueryDialog from './lib/components/SaveQueryDialog.svelte';
  import FindInNotesDialog from './lib/components/FindInNotesDialog.svelte';
  import OcrProgressDialog from './lib/components/OcrProgressDialog.svelte';
  import GotoNoteDialog from './lib/components/GotoNoteDialog.svelte';
  import ToolPanel from './lib/components/ToolPanel.svelte';
  import ConversationsPanel from './lib/components/ConversationsPanel.svelte';
  import AutoLinkDialog from './lib/components/AutoLinkDialog.svelte';
  import AutoLinkInboundDialog from './lib/components/AutoLinkInboundDialog.svelte';
  import BusyOverlay from './lib/components/BusyOverlay.svelte';
  import CsvTable from './lib/components/CsvTable.svelte';
  import type { AutoLinkSuggestion } from '../shared/refactor/auto-link';
  import type { AutoLinkInboundSuggestion } from '../shared/refactor/auto-link-inbound';
  import SettingsDialog from './lib/components/SettingsDialog.svelte';
  import OnboardingDialog from './lib/components/OnboardingDialog.svelte';
  import type { OnboardingAnswers } from './lib/components/OnboardingDialog.svelte';
  import { api } from './lib/ipc/client';
  import { getNavigationStore } from './lib/stores/navigation.svelte';
  import { initTheme, cycleTheme, getThemeMode } from './lib/theme';
  import { slugify } from '../shared/slug';
  import { initAppearance } from './lib/appearance/settings';
  import { getToolPanelStore } from './lib/stores/tool-panel.svelte';
  import { getConversationsStore } from './lib/stores/conversations.svelte';
  import { getBookmarksStore } from './lib/stores/bookmarks.svelte';
  import { getConfirmSuppressionStore } from './lib/stores/confirm-suppression.svelte';
  import { CONFIRM_KEYS } from './lib/confirm-keys';
  import { isMissingApiKeyError } from '../shared/llm-errors';
  import { ENTRYPOINT_TAG } from '../shared/entrypoint';
  import { runCellWithTrust } from './lib/compute/run-cell-with-trust';
  import {
    planExtract,
    planSplitHere,
    deriveProposedTitle,
    todayDateString,
  } from './lib/refactor/extract';
  import { planSplitByHeading } from './lib/refactor/split-by-heading';
  import {
    planCreateFromConversation,
    suggestConversationNoteTitle,
  } from './lib/refactor/create-from-conversation';
  import { getRefactorSettings } from './lib/refactor/settings';
  import { getFormatSettings, loadFormatSettings } from './lib/formatter/settings';
  import { toggleTaskOnLine } from './lib/editor/task-toggle';
  import { gatherContext } from './lib/tools/context';
  import { getAllToolInfos } from './lib/tools/tool-registry';
  import type { ToolContext } from '../shared/tools/types';

  type ViewMode = 'source' | 'preview' | 'split';

  const notebase = getNotebaseStore();
  const editor = getEditorStore();
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

  /** Pending Auto-link suggestions to review. Non-null means the AutoLinkDialog is shown. */
  let autoLinkReview = $state<{
    relativePath: string;
    suggestions: AutoLinkSuggestion[];
    activeBody: string;
  } | null>(null);
  /** Whether the Auto-link suggest request is currently in flight. Keeps the menu from re-triggering. */
  let autoLinkBusy = $state(false);
  /** When set, renders a modal spinner overlay with this label. */
  let busyLabel = $state<string | null>(null);

  /** Pending Auto-link inbound suggestions to review. Non-null = dialog is shown. */
  let autoLinkInboundReview = $state<{
    relativePath: string;
    suggestions: AutoLinkInboundSuggestion[];
  } | null>(null);

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
  let promptDialog = $state<{ message: string; suggestions?: string[]; initial?: string; resolve: (value: string | null) => void } | null>(null);
  let confirmDialog = $state<{ message: string; confirmLabel: string; key: string; hideDontAskAgain?: boolean; resolve: (value: boolean) => void } | null>(null);
  let exportDialogFor = $state<string | null>(null);
  /**
   * Three-way prompt for opening / creating a thoughtbase when the
   * current window already holds one. `null` means no dialog open.
   */
  let openTargetDialog = $state<{
    message: string;
    resolve: (choice: 'this' | 'new' | 'cancel') => void;
  } | null>(null);
  const confirmSuppression = getConfirmSuppressionStore();

  function showPrompt(
    message: string,
    initialOrOptions?: string | { suggestions?: string[]; initial?: string },
  ): Promise<string | null> {
    // Two overloads to keep call sites readable. New callers pass
    // (message, "current name") for Rename-style flows; existing
    // callers can keep their {suggestions} object.
    const opts = typeof initialOrOptions === 'string'
      ? { initial: initialOrOptions }
      : (initialOrOptions ?? {});
    return new Promise((resolve) => {
      promptDialog = { message, suggestions: opts.suggestions, initial: opts.initial, resolve };
    });
  }

  function showConfirm(
    message: string,
    key: string,
    confirmLabel = 'OK',
    options: { hideDontAskAgain?: boolean } = {},
  ): Promise<boolean> {
    if (confirmSuppression.isSuppressed(key)) return Promise.resolve(true);
    return new Promise((resolve) => {
      confirmDialog = { message, confirmLabel, key, hideDontAskAgain: options.hideDontAskAgain, resolve };
    });
  }

  function handlePromptConfirm(value: string) {
    promptDialog?.resolve(value);
    promptDialog = null;
  }

  function handlePromptCancel() {
    promptDialog?.resolve(null);
    promptDialog = null;
  }

  function handleConfirmOk(dontAskAgain: boolean) {
    if (dontAskAgain && confirmDialog) {
      confirmSuppression.suppress(confirmDialog.key);
    }
    confirmDialog?.resolve(true);
    confirmDialog = null;
  }

  function handleConfirmCancel() {
    confirmDialog?.resolve(false);
    confirmDialog = null;
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

  /** Cheap slug for path placeholders in the system prompt. The agent
   *  may override these paths; this is just a sensible default. */
  function slugifyForPath(s: string): string {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'overview';
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
  const commands = $derived<Command[]>(buildCommandRegistry());

  function buildCommandRegistry(): Command[] {
    const hasProject = !!notebase.meta;
    const hasNote = !!editor.activeFilePath;
    const hasActiveNoteTab = editor.activeTab?.type === 'note';
    const list: Command[] = [
      // ── File ──
      { id: 'file.newNote', title: 'New Note', category: 'File',
        keybinding: formatAccelerator('CmdOrCtrl+N'),
        enabled: hasProject, run: () => handleNewNote() },
      { id: 'file.save', title: 'Save', category: 'File',
        keybinding: formatAccelerator('CmdOrCtrl+S'),
        enabled: hasNote, run: () => handleSave() },
      { id: 'file.openProject', title: 'Open Thoughtbase…', category: 'File',
        keybinding: formatAccelerator('CmdOrCtrl+O'),
        enabled: true, run: () => handleOpenThoughtbase() },
      { id: 'file.newProject', title: 'New Thoughtbase…', category: 'File',
        keybinding: null, enabled: true, run: () => handleNewThoughtbase() },
      { id: 'file.closeProject', title: 'Close Thoughtbase', category: 'File',
        keybinding: formatAccelerator('CmdOrCtrl+Shift+W'),
        enabled: hasProject, run: () => { notebase.close(); editor.clear(); } },
      { id: 'file.print', title: 'Print…', category: 'File',
        keybinding: null, enabled: hasNote, run: () => window.print() },
      // ── Edit / search ──
      { id: 'edit.find', title: 'Find', category: 'Edit',
        keybinding: formatAccelerator('CmdOrCtrl+F'),
        enabled: hasNote, run: () => editorComponent?.openFind() },
      { id: 'edit.findReplace', title: 'Find and Replace', category: 'Edit',
        keybinding: formatAccelerator('CmdOrCtrl+H'),
        enabled: hasNote, run: () => editorComponent?.openFindReplace() },
      { id: 'edit.findInNotes', title: 'Find in Notes…', category: 'Edit',
        keybinding: formatAccelerator('CmdOrCtrl+Shift+F'),
        enabled: hasProject, run: () => { findInNotesMode = 'find'; } },
      { id: 'edit.replaceInNotes', title: 'Replace in Notes…', category: 'Edit',
        keybinding: formatAccelerator('CmdOrCtrl+Shift+H'),
        enabled: hasProject, run: () => { findInNotesMode = 'replace'; } },
      { id: 'edit.gotoLine', title: 'Go to Line…', category: 'Edit',
        keybinding: null, enabled: hasNote, run: () => { showGotoLine = true; } },
      { id: 'edit.sortLines', title: 'Sort Lines', category: 'Edit',
        keybinding: null, enabled: hasNote, run: () => editorComponent?.runSortLines() },
      // ── View ──
      { id: 'view.toggleSidebar', title: 'Toggle Left Sidebar', category: 'View',
        keybinding: null, enabled: true, run: () => { sidebarVisible = !sidebarVisible; } },
      { id: 'view.toggleRightSidebar', title: 'Toggle Right Sidebar', category: 'View',
        keybinding: null, enabled: true, run: () => { rightSidebarVisible = !rightSidebarVisible; } },
      { id: 'view.togglePreview', title: 'Toggle Preview Mode', category: 'View',
        keybinding: null, enabled: hasNote, run: () => cycleViewMode() },
      { id: 'view.toggleConversations', title: 'Toggle Conversations', category: 'View',
        keybinding: null, enabled: true, run: () => conversationsStore.toggle() },
      { id: 'view.cycleTheme', title: 'Cycle Theme', category: 'View',
        keybinding: null, enabled: true, run: () => handleCycleTheme() },
      { id: 'view.fontIncrease', title: 'Increase Font Size', category: 'View',
        keybinding: null, enabled: true,
        run: () => { editorComponent?.changeFontSize(1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; } },
      { id: 'view.fontDecrease', title: 'Decrease Font Size', category: 'View',
        keybinding: null, enabled: true,
        run: () => { editorComponent?.changeFontSize(-1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; } },
      { id: 'view.fontReset', title: 'Reset Font Size', category: 'View',
        keybinding: null, enabled: true,
        run: () => { editorComponent?.resetFontSize(); editorFontSize = 14; } },
      // ── Navigate ──
      { id: 'nav.quickOpen', title: 'Go to…', category: 'Navigate',
        keybinding: formatAccelerator('CmdOrCtrl+P'),
        enabled: hasProject,
        run: () => {
          void refreshSourcesCache();
          void refreshSavedQueriesCache();
          showGotoNote = true;
        } },
      { id: 'nav.back', title: 'Navigate Back', category: 'Navigate',
        keybinding: formatAccelerator('CmdOrCtrl+['),
        enabled: nav.canGoBack, run: () => handleNavBack() },
      { id: 'nav.forward', title: 'Navigate Forward', category: 'Navigate',
        keybinding: formatAccelerator('CmdOrCtrl+]'),
        enabled: nav.canGoForward, run: () => handleNavForward() },
      // ── Refactor ──
      { id: 'refactor.rename', title: 'Rename Note…', category: 'Refactor',
        keybinding: null, enabled: hasNote,
        run: () => { if (editor.activeFilePath) void handleRename(editor.activeFilePath); } },
      { id: 'refactor.move', title: 'Move Note…', category: 'Refactor',
        keybinding: null, enabled: hasNote,
        run: () => { if (editor.activeFilePath) void handleMoveWithPrompt(editor.activeFilePath); } },
      { id: 'refactor.copy', title: 'Copy Note…', category: 'Refactor',
        keybinding: null, enabled: hasNote,
        run: () => { if (editor.activeFilePath) void handleCopyWithPrompt(editor.activeFilePath); } },
      { id: 'refactor.extract', title: 'Extract Selection to New Note', category: 'Refactor',
        keybinding: null, enabled: hasActiveNoteTab, run: () => handleExtractSelection() },
      { id: 'refactor.splitHere', title: 'Split Here', category: 'Refactor',
        keybinding: null, enabled: hasActiveNoteTab, run: () => handleSplitHere() },
      { id: 'refactor.splitByHeading', title: 'Split by Heading…', category: 'Refactor',
        keybinding: null, enabled: hasActiveNoteTab, run: () => handleSplitByHeading() },
      { id: 'refactor.autoTag', title: 'Auto-tag Note', category: 'Refactor',
        keybinding: null, enabled: hasNote,
        run: () => { if (editor.activeFilePath) void handleAutoTag(editor.activeFilePath); } },
      { id: 'refactor.autoLink', title: 'Auto-link Outbound', category: 'Refactor',
        keybinding: null, enabled: hasNote,
        run: () => { if (editor.activeFilePath) void handleAutoLink(editor.activeFilePath); } },
      { id: 'refactor.autoLinkInbound', title: 'Auto-link Inbound', category: 'Refactor',
        keybinding: null, enabled: hasNote,
        run: () => { if (editor.activeFilePath) void handleAutoLinkInbound(editor.activeFilePath); } },
      { id: 'refactor.decompose', title: 'Decompose into Claims', category: 'Refactor',
        keybinding: null, enabled: hasNote,
        run: () => { if (editor.activeFilePath) void handleDecompose(editor.activeFilePath); } },
      { id: 'refactor.format', title: 'Format', category: 'Refactor',
        keybinding: null, enabled: hasNote, run: () => handleFormat() },
      // ── Research ──
      { id: 'research.ingestUrl', title: 'Ingest URL…', category: 'Research',
        keybinding: formatAccelerator('CmdOrCtrl+Shift+I'),
        enabled: hasProject, run: () => handleIngestUrl() },
      { id: 'research.ingestIdentifier', title: 'Ingest Identifier…', category: 'Research',
        keybinding: formatAccelerator('CmdOrCtrl+Shift+D'),
        enabled: hasProject, run: () => handleIngestIdentifier() },
      { id: 'research.ingestPdf', title: 'Ingest PDF…', category: 'Research',
        keybinding: null, enabled: hasProject, run: () => handleIngestPdf() },
      { id: 'research.importBibtex', title: 'Import BibTeX…', category: 'Research',
        keybinding: null, enabled: hasProject, run: () => handleImportBibtex() },
      { id: 'research.importZoteroRdf', title: 'Import Zotero RDF…', category: 'Research',
        keybinding: null, enabled: hasProject, run: () => handleImportZoteroRdf() },
      { id: 'research.bibliography', title: 'Insert/Update Bibliography', category: 'Research',
        keybinding: null, enabled: hasNote, run: () => { void handleBibliography(); } },
      // ── Query ──
      { id: 'query.new', title: 'New Query', category: 'Query',
        keybinding: null, enabled: hasProject, run: () => editor.openQuery() },
      { id: 'query.editSaved', title: 'Edit Saved Queries…', category: 'Query',
        keybinding: null, enabled: hasProject, run: () => { showEditSavedQueries = true; } },
      // ── Settings / app ──
      { id: 'app.settings', title: 'Settings…', category: 'App',
        keybinding: formatAccelerator('CmdOrCtrl+,'),
        enabled: true, run: () => { showSettings = true; } },
    ];
    return list;
  }
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
  let ocrSession = $state<{ sourceId: string; title: string; pageCount: number } | null>(null);
  let ocrPdfBytes = $state<Uint8Array | null>(null);

  async function handleFileSelect(relativePath: string, searchQuery?: string) {
    recordCurrentPosition();
    const existingTab = editor.tabs.find((t) => t.type === 'note' && t.relativePath === relativePath) as import('./lib/stores/editor.svelte').NoteTab | undefined;
    const savedOffset = existingTab?.cursorOffset;
    const savedScroll = existingTab?.scrollTop;
    pendingSearchQuery = searchQuery ?? null;
    await editor.openFile(relativePath);
    if (!searchQuery && savedOffset != null) {
      await tick();
      requestAnimationFrame(() => {
        editorComponent?.restorePosition(savedOffset, savedScroll);
      });
      nav.record({ type: 'note', relativePath, offset: savedOffset });
    } else {
      nav.record({ type: 'note', relativePath, offset: 0 });
    }
  }

  let pendingPreviewAnchor = $state<string | null>(null);

  async function handleNavigate(target: string) {
    recordCurrentPosition();
    const hashIdx = target.indexOf('#');
    const pathPart = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
    const anchor = hashIdx >= 0 ? target.slice(hashIdx + 1) : null;
    // Resolve against the actual note tree before falling back to a
    // naive `${target}.md`. Lets short-form wiki-links like [[raft]],
    // [[Sets, Functions]], or [[journey/raft]] open the correct file
    // regardless of how deeply nested it is.
    const flat = flattenNoteFiles(notebase.files);
    const resolved = resolveWikiLinkTarget(pathPart, flat, aliasMap);
    const notePath = resolved ?? (pathPart.endsWith('.md') ? pathPart : `${pathPart}.md`);
    await editor.openFile(notePath);
    // Route anchors: preview scrolls by element id; editor jumps by doc offset.
    if (anchor) {
      pendingPreviewAnchor = anchor;
      if (viewMode === 'source' || viewMode === 'split') {
        const content = editor.content;
        const offset = findAnchorOffset(content, anchor);
        if (offset !== null) {
          requestAnimationFrame(() => editorComponent?.gotoOffset(offset));
        }
      }
    }
    nav.record({ type: 'note', relativePath: notePath, offset: 0 });
  }

  /**
   * Locate a heading (by slug) or block-id inside raw markdown and return
   * the character offset of its line. Shared between source and split modes.
   */
  function findAnchorOffset(text: string, anchor: string): number | null {
    const isBlockId = anchor.startsWith('^');
    const lines = text.split('\n');
    let offset = 0;
    for (const line of lines) {
      if (isBlockId) {
        if (line.trimEnd().endsWith(anchor)) return offset;
      } else {
        const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (m && slugify(m[2]) === anchor) return offset;
      }
      offset += line.length + 1;
    }
    return null;
  }

  function handleSourceDeleted(sourceId: string) {
    // Close any open tab for this source so the user isn't staring at
    // a ghost viewer after delete.
    const idx = editor.tabs.findIndex((t) => t.type === 'source' && t.sourceId === sourceId);
    if (idx !== -1) editor.closeTab(idx);
  }

  function handleOpenSource(sourceId: string, highlightExcerptId?: string) {
    recordCurrentPosition();
    editor.openSource(sourceId, { highlightExcerptId });
    nav.record({ type: 'source', sourceId, highlightExcerptId });
  }

  async function handleOpenExcerpt(excerptId: string) {
    const result = await api.graph.excerptSource(excerptId);
    if (!result) return;
    handleOpenSource(result.sourceId, excerptId);
  }

  /** Flatten the sidebar file tree to a list of indexable relative paths. */
  function flattenNotePaths(files: import('../shared/types').NoteFile[]): string[] {
    const out: string[] = [];
    const walk = (xs: import('../shared/types').NoteFile[]) => {
      for (const f of xs) {
        if (f.isDirectory) walk(f.children ?? []);
        else if (/\.(md|ttl|csv)$/.test(f.relativePath)) out.push(f.relativePath);
      }
    };
    walk(files);
    return out;
  }

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

  // ── Note refactoring: extract / split ──────────────────────────────────

  async function resolveTitle(body: string): Promise<string | null> {
    const derived = deriveProposedTitle(body);
    if (derived) return derived;
    return showPrompt('New note name:');
  }

  /**
   * "Create note" from the active conversation (#177). Body comes
   * from the user's selection in the conversation pane if any;
   * otherwise the most recent assistant message. The new note's
   * frontmatter records the source note + conversation id for
   * traceability.
   *
   * Lands in the same folder as the conversation's origin note
   * (when there is one), or at the thoughtbase root for freeform
   * conversations. Honours the Refactoring settings tab's
   * destination + filename-prefix templates.
   */
  async function handleCreateNoteFromConversation(args: {
    conversation: import('../shared/types').Conversation;
    selectionText: string;
    fallbackText: string;
  }): Promise<void> {
    if (!notebase.meta) return;
    const body = args.selectionText.trim() || args.fallbackText.trim();
    if (!body) {
      await showConfirm(
        'Nothing to create from — the conversation has no assistant text yet.',
        CONFIRM_KEYS.createNoteFromConvEmpty,
        'OK',
      );
      return;
    }
    const suggested = suggestConversationNoteTitle(body);
    const title = suggested ?? await showPrompt('New note name:');
    if (!title) return;

    const sourceRelativePath = args.conversation.contextBundle.notePath ?? null;
    const plan = planCreateFromConversation({
      title,
      body,
      sourceRelativePath,
      conversationId: args.conversation.id,
      today: new Date().toISOString().slice(0, 10),
      settings: getRefactorSettings(),
    });

    try {
      // Loop on collision so the second-of-the-same-title doesn't
      // clobber the first. Existing extract / split-here paths
      // accept clobbers, but conversation-source notes are likely
      // to land repeatedly off the same prompts.
      let path = plan.newNotePath;
      for (let attempt = 2; attempt < 20; attempt++) {
        if (!(await api.notebase.fileExists(path))) break;
        const dot = plan.newNotePath.lastIndexOf('.md');
        path = dot > 0
          ? `${plan.newNotePath.slice(0, dot)}-${attempt}.md`
          : `${plan.newNotePath}-${attempt}`;
      }
      await api.notebase.writeFile(path, plan.newNoteContent);
      await notebase.refresh();
      await editor.openFile(path);
      sidebar?.refreshTags();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Couldn't create note: ${msg}`, CONFIRM_KEYS.createNoteFromConvFailed, 'OK');
    }
  }

  async function handleExtractSelection() {
    if (!notebase.meta) return;
    const tab = editor.activeNoteTab;
    if (!tab) return;
    const selection = editorComponent?.getSelectionRange();
    if (!selection) return;
    const selectedText = tab.content.slice(selection.from, selection.to);
    const title = await resolveTitle(selectedText);
    if (!title) return;

    editor.flushAutoSave();
    const plan = planExtract({
      sourceRelativePath: tab.relativePath,
      sourceContent: tab.content,
      selection,
      title,
      today: todayDateString(),
      settings: getRefactorSettings(),
    });

    await api.notebase.writeFile(plan.newNotePath, plan.newNoteContent);
    await api.notebase.writeFile(tab.relativePath, plan.updatedSourceContent);
    // The active tab still holds the pre-extract content in memory; reload
    // it from disk so the user sees the wiki-link and so the next auto-save
    // doesn't overwrite our rewrite.
    await editor.reloadTabFromDisk(tab.relativePath);
    await notebase.refresh();
    await editor.openFile(plan.newNotePath);
    sidebar?.refreshTags();
  }

  async function handleSplitByHeading() {
    if (!notebase.meta) return;
    const tab = editor.activeNoteTab;
    if (!tab) return;

    const answer = await showPrompt('Heading level to split on (1, 2, or 3):');
    if (!answer) return;
    const level = parseInt(answer.trim(), 10);
    if (level !== 1 && level !== 2 && level !== 3) return;

    editor.flushAutoSave();
    const plan = planSplitByHeading({
      sourceRelativePath: tab.relativePath,
      sourceContent: tab.content,
      level: level,
      today: todayDateString(),
      settings: getRefactorSettings(),
    });

    if (plan.newNotes.length === 0) return;

    for (const note of plan.newNotes) {
      await api.notebase.writeFile(note.relativePath, note.content);
    }
    await api.notebase.writeFile(tab.relativePath, plan.updatedSourceContent);
    await editor.reloadTabFromDisk(tab.relativePath);
    await notebase.refresh();
    sidebar?.refreshTags();
  }

  async function handleSplitHere() {
    if (!notebase.meta) return;
    const tab = editor.activeNoteTab;
    if (!tab) return;
    const cursor = editorComponent?.getOffset() ?? 0;
    if (cursor >= tab.content.length) return;

    const tail = tab.content.slice(cursor);
    const title = await resolveTitle(tail);
    if (!title) return;

    editor.flushAutoSave();
    const plan = planSplitHere({
      sourceRelativePath: tab.relativePath,
      sourceContent: tab.content,
      cursor,
      title,
      today: todayDateString(),
      settings: getRefactorSettings(),
    });

    await api.notebase.writeFile(plan.newNotePath, plan.newNoteContent);
    await api.notebase.writeFile(tab.relativePath, plan.updatedSourceContent);
    await editor.reloadTabFromDisk(tab.relativePath);
    await notebase.refresh();
    await editor.openFile(plan.newNotePath);
    sidebar?.refreshTags();
  }

  async function handleNewNote(directory: string = '') {
    if (!notebase.meta) return;
    const name = await showPrompt('Note name:');
    if (!name) return;
    const filename = name.endsWith('.md') ? name : `${name}.md`;
    const relativePath = directory ? `${directory}/${filename}` : filename;
    await api.notebase.createFile(relativePath);
    await notebase.refresh();
    await editor.openFile(relativePath);
    sidebar?.refreshTags();
  }

  /** Zotero-style "New note about this source" (#474). Creates a note
   *  pre-populated with `about: [[sources/<id>]]` frontmatter so it
   *  immediately surfaces under the source's Notes section. */
  async function handleNewAboutSourceNote(sourceId: string): Promise<string | null> {
    if (!notebase.meta) return null;
    const name = await showPrompt('Note name:');
    if (!name) return null;
    const filename = name.endsWith('.md') ? name : `${name}.md`;
    const relativePath = filename;
    const titleStem = name.replace(/\.md$/, '');
    const initialContent = `---\nabout: [[sources/${sourceId}]]\n---\n\n# ${titleStem}\n\n`;
    await api.notebase.writeFile(relativePath, initialContent);
    await notebase.refresh();
    await editor.openFile(relativePath);
    sidebar?.refreshTags();
    return relativePath;
  }

  async function handleNewFolder(directory: string = '') {
    if (!notebase.meta) return;
    const name = await showPrompt('Folder name:');
    if (!name) return;
    const relativePath = directory ? `${directory}/${name}` : name;
    await api.notebase.createFolder(relativePath);
    await notebase.refresh();
  }

  /**
   * Selection-driven Delete. Same model as Format: the sidebar's
   * multi-selection is the source of truth, and the right-click menu
   * has already promoted single-clicks to single-selections. The
   * (relativePath, isDirectory) args are kept for the legacy callback
   * signature but ignored when a selection exists.
   *
   * Best-effort across all targets: failures are collected and
   * reported in one summary dialog rather than aborting the batch.
   * `closeTabsForDeletedPath` runs per successful target so a folder
   * delete also closes any open tabs for files inside it.
   */
  async function handleDelete(relativePath: string, isDirectory: boolean) {
    if (!notebase.meta) return;

    const selectionPaths = sidebar?.getSelectionPaths() ?? [];
    const targets = selectionPaths.length > 0
      ? resolveSelectionTargets(new Set(selectionPaths), notebase.files)
      : [{ relativePath, isDirectory }];
    if (targets.length === 0) return;

    const noun = (() => {
      if (targets.length === 1) return targets[0].isDirectory ? 'folder' : 'note';
      const allDirs = targets.every((t) => t.isDirectory);
      const allFiles = targets.every((t) => !t.isDirectory);
      if (allDirs) return 'folders';
      if (allFiles) return 'notes';
      return 'items';
    })();

    let message: string;
    if (targets.length === 1) {
      const name = targets[0].relativePath.split('/').pop();
      message = `Delete ${noun} "${name}"?`;
    } else {
      const sample = targets.slice(0, 3).map((t) => t.relativePath).join(', ');
      const more = targets.length > 3 ? ', …' : '';
      message = `Delete ${targets.length} ${noun} (${sample}${more})?`;
    }

    const confirmed = await showConfirm(message, CONFIRM_KEYS.delete, 'Delete');
    if (!confirmed) return;

    const failures: Array<{ path: string; error: string }> = [];
    for (const t of targets) {
      try {
        if (t.isDirectory) {
          await api.notebase.deleteFolder(t.relativePath);
        } else {
          await api.notebase.deleteFile(t.relativePath);
        }
        editor.closeTabsForDeletedPath(t.relativePath);
      } catch (err) {
        failures.push({
          path: t.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await notebase.refresh();
    sidebar?.refreshTags();
    sidebar?.clearSelection();

    if (failures.length > 0) {
      const head = failures.slice(0, 5).map((f) => `• ${f.path}: ${f.error}`).join('\n');
      const tail = failures.length > 5 ? `\n…and ${failures.length - 5} more` : '';
      await showConfirm(
        `Failed to delete ${failures.length} of ${targets.length} item${targets.length === 1 ? '' : 's'}:\n${head}${tail}`,
        CONFIRM_KEYS.deletePartialFailure,
        'OK',
      );
    }
  }

  // ── Sidebar clipboard ──────────────────────────────────────────────────

  /**
   * Multi-path clipboard. Cut / Copy capture the current sidebar
   * selection at click time (the right-click menu has already promoted
   * single-clicks to single-selections, so the selection always
   * matches what the user expects). The (relativePath, isDirectory)
   * args from the menu callback are kept as a fallback for the rare
   * path where the menu fires without a populated selection.
   */
  let clipboardItems = $state<{
    items: Array<{ relativePath: string; isDirectory: boolean }>;
    mode: 'cut' | 'copy';
  } | null>(null);

  function collectClipboardTargets(
    fallbackPath: string,
    fallbackIsDir: boolean,
  ): Array<{ relativePath: string; isDirectory: boolean }> {
    const sel = sidebar?.getSelectionPaths() ?? [];
    if (sel.length > 0) return resolveSelectionTargets(new Set(sel), notebase.files);
    return [{ relativePath: fallbackPath, isDirectory: fallbackIsDir }];
  }

  function handleCut(relativePath: string, isDirectory: boolean) {
    clipboardItems = { items: collectClipboardTargets(relativePath, isDirectory), mode: 'cut' };
  }

  function handleCopy(relativePath: string, isDirectory: boolean) {
    clipboardItems = { items: collectClipboardTargets(relativePath, isDirectory), mode: 'copy' };
  }

  /**
   * Drag-move. When the dragged path is itself part of the sidebar
   * selection, every selected item moves to `destDirectory` (Finder /
   * VS Code convention). Otherwise we move just the dragged item —
   * dragging a non-selected row should not silently drag the
   * selection elsewhere on screen.
   *
   * Per-item: skip same-dir no-ops, skip collisions (collected for the
   * summary), retarget any open tab whose path was the source.
   */
  async function handleMove(srcPath: string, destDirectory: string) {
    if (!notebase.meta) return;

    const sel = sidebar?.getSelectionPaths() ?? [];
    const targets =
      sel.includes(srcPath) && sel.length > 1
        ? resolveSelectionTargets(new Set(sel), notebase.files)
        : (() => {
            // Look up isDirectory from the tree so a folder drag still
            // round-trips correctly (rename works for both, but resolving
            // here keeps the shape consistent for the summary dialog).
            const exists = pathExistsInTree(srcPath, notebase.files);
            if (!exists) return [];
            const stack = [...notebase.files];
            while (stack.length) {
              const n = stack.pop()!;
              if (n.relativePath === srcPath) return [{ relativePath: srcPath, isDirectory: !!n.isDirectory }];
              if (n.children) stack.push(...n.children);
            }
            return [];
          })();
    if (targets.length === 0) return;

    const collisions: string[] = [];
    const failures: Array<{ path: string; error: string }> = [];
    for (const t of targets) {
      const name = t.relativePath.split('/').pop()!;
      const destPath = destDirectory ? `${destDirectory}/${name}` : name;
      if (destPath === t.relativePath) continue;
      if (pathExistsInTree(destPath, notebase.files)) {
        collisions.push(destPath);
        continue;
      }
      try {
        await api.notebase.rename(t.relativePath, destPath);
        const tabIdx = editor.tabs.findIndex((tab) => tab.type === 'note' && tab.relativePath === t.relativePath);
        if (tabIdx !== -1) {
          const tab = editor.tabs[tabIdx];
          if (tab.type === 'note') {
            tab.relativePath = destPath;
            tab.fileName = name;
          }
        }
      } catch (err) {
        failures.push({ path: t.relativePath, error: err instanceof Error ? err.message : String(err) });
      }
    }
    await notebase.refresh();
    sidebar?.clearSelection();
    if (collisions.length > 0 || failures.length > 0) {
      await reportClipboardSummary('Move', targets.length, collisions, failures);
    }
  }

  /**
   * Paste handler for the multi-path clipboard. Cut+Paste renames
   * each item into `destDirectory` and clears the clipboard +
   * selection on success; Copy+Paste leaves both alone (the user may
   * want to paste again somewhere else). Collisions and failures are
   * collected per-item and reported in a single summary dialog rather
   * than aborting the batch.
   */
  async function handlePaste(destDirectory: string) {
    if (!clipboardItems || !notebase.meta) return;
    const { items, mode } = clipboardItems;

    const collisions: string[] = [];
    const failures: Array<{ path: string; error: string }> = [];
    for (const item of items) {
      const name = item.relativePath.split('/').pop()!;
      const destPath = destDirectory ? `${destDirectory}/${name}` : name;
      if (destPath === item.relativePath) continue;
      if (pathExistsInTree(destPath, notebase.files)) {
        collisions.push(destPath);
        continue;
      }
      try {
        if (mode === 'cut') {
          await api.notebase.rename(item.relativePath, destPath);
          const tabIdx = editor.tabs.findIndex((t) => t.type === 'note' && t.relativePath === item.relativePath);
          if (tabIdx !== -1) {
            const tab = editor.tabs[tabIdx];
            if (tab.type === 'note') {
              tab.relativePath = destPath;
              tab.fileName = name;
            }
          }
        } else {
          await api.notebase.copy(item.relativePath, destPath);
        }
      } catch (err) {
        failures.push({ path: item.relativePath, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (mode === 'cut') {
      clipboardItems = null;
      sidebar?.clearSelection();
    }
    await notebase.refresh();
    if (collisions.length > 0 || failures.length > 0) {
      await reportClipboardSummary(mode === 'cut' ? 'Move' : 'Copy', items.length, collisions, failures);
    }
  }

  async function reportClipboardSummary(
    label: 'Move' | 'Copy',
    total: number,
    collisions: string[],
    failures: Array<{ path: string; error: string }>,
  ): Promise<void> {
    const lines: string[] = [];
    if (collisions.length > 0) {
      const head = collisions.slice(0, 5).map((p) => `• ${p}`).join('\n');
      const tail = collisions.length > 5 ? `\n…and ${collisions.length - 5} more` : '';
      lines.push(`Skipped ${collisions.length} (destination already exists):\n${head}${tail}`);
    }
    if (failures.length > 0) {
      const head = failures.slice(0, 5).map((f) => `• ${f.path}: ${f.error}`).join('\n');
      const tail = failures.length > 5 ? `\n…and ${failures.length - 5} more` : '';
      lines.push(`Failed (${failures.length}):\n${head}${tail}`);
    }
    const skipped = collisions.length + failures.length;
    const completed = total - skipped;
    const key = label === 'Move' ? CONFIRM_KEYS.moveCollision : CONFIRM_KEYS.copyCollision;
    await showConfirm(
      `${label} complete: ${completed} of ${total}.\n\n${lines.join('\n\n')}`,
      key,
      'OK',
    );
  }

  /**
   * Merge note (#464). Two-step: open a target picker (a filtered
   * GotoNoteDialog), then run `performMerge` against the chosen target.
   * Flushes any unsaved buffer for the source so the merge sees the
   * latest content rather than a stale on-disk copy.
   */
  function handleMerge(sourceRelPath: string) {
    if (!notebase.meta) return;
    editor.flushAutoSave();
    mergePickerSource = sourceRelPath;
  }

  async function performMerge(sourceRelPath: string, targetRelPath: string) {
    if (sourceRelPath === targetRelPath) return;
    const sourceName = sourceRelPath.split('/').pop()?.replace(/\.md$/i, '') ?? sourceRelPath;
    const targetName = targetRelPath.split('/').pop()?.replace(/\.md$/i, '') ?? targetRelPath;
    try {
      const preview = await withBusy('Counting incoming links…', () =>
        api.notebase.mergePreview(sourceRelPath, targetRelPath),
      );
      const linkLine = preview.linkOccurrences > 0
        ? `${preview.linkOccurrences} link${preview.linkOccurrences === 1 ? '' : 's'} across ${preview.affectedFiles} file${preview.affectedFiles === 1 ? '' : 's'} will be updated.`
        : 'No incoming links — only the source content will move.';
      const ok = await showConfirm(
        `Merge "${sourceName}" into "${targetName}"?\n\n${linkLine}\n\nThe source note's content is appended to the target; its frontmatter is dropped; the source note is then deleted.`,
        CONFIRM_KEYS.mergeNote,
        'Merge',
      );
      if (!ok) return;
      const result = await withBusy('Merging…', () =>
        api.notebase.merge(sourceRelPath, targetRelPath),
      );
      // Open the target and scroll to the merge point. The
      // NOTEBASE_RENAMED / NOTEBASE_REWRITTEN broadcasts handle tab
      // cleanup for the source and any open referrers.
      await editor.openFile(result.targetPath);
      requestAnimationFrame(() => {
        editorComponent?.gotoLineColumn(result.mergeLine, 1);
      });
      await notebase.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Merge failed: ${msg}`, CONFIRM_KEYS.mergeFailed, 'OK');
    }
  }

  async function handleRename(relativePath: string) {
    if (!notebase.meta) return;
    const oldName = relativePath.split('/').pop()!;
    const rawNewName = await showPrompt('New name:');
    if (!rawNewName || rawNewName === oldName) return;
    // Preserve the old extension when the user didn't include one. A file
    // that drops its .md / .ttl suffix falls out of the indexed set and
    // effectively disappears from the sidebar; almost always a mistake.
    const oldDotIdx = oldName.lastIndexOf('.');
    const oldExt = oldDotIdx > 0 ? oldName.slice(oldDotIdx) : '';
    const newName = !rawNewName.includes('.') && oldExt ? `${rawNewName}${oldExt}` : rawNewName;
    const dir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    const newPath = dir ? `${dir}/${newName}` : newName;
    // Tab path + content refresh is handled by the NOTEBASE_RENAMED /
    // NOTEBASE_REWRITTEN listeners registered in onMount — don't duplicate.
    await api.notebase.rename(relativePath, newPath);
    await notebase.refresh();
  }

  /**
   * Runs `fn` with the spinner overlay shown under `label`. Always clears
   * the overlay before returning — even on error — so that subsequent UI
   * (e.g. an error dialog) isn't trapped behind it.
   */
  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
    busyLabel = label;
    try {
      return await fn();
    } finally {
      busyLabel = null;
    }
  }

  async function handleAutoLink(relativePath: string) {
    if (!notebase.meta || autoLinkBusy) return;
    autoLinkBusy = true;
    try {
      const { suggestions } = await withBusy('Auto-linking\u2026', () =>
        api.refactor.autoLinkSuggest(relativePath),
      );
      if (suggestions.length === 0) {
        await showConfirm(
          'Auto-link found no link candidates in this note.',
          CONFIRM_KEYS.autoLinkNoSuggestions,
          'OK',
        );
        return;
      }
      // Snapshot the current body (sans frontmatter) for context snippets in the dialog.
      const raw = await api.notebase.readFile(relativePath);
      const activeBody = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
      autoLinkReview = { relativePath, suggestions, activeBody };
    } catch (err) {
      if (await maybeHandleMissingApiKey(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-link failed: ${msg}`, CONFIRM_KEYS.autoLinkFailed, 'OK');
    } finally {
      autoLinkBusy = false;
    }
  }

  async function handleAutoLinkInbound(relativePath: string) {
    if (!notebase.meta || autoLinkBusy) return;
    autoLinkBusy = true;
    try {
      const { suggestions } = await withBusy('Scanning other notes\u2026', () =>
        api.refactor.autoLinkInboundSuggest(relativePath),
      );
      if (suggestions.length === 0) {
        await showConfirm(
          'Auto-link inbound found no places in other notes where a link here would fit.',
          CONFIRM_KEYS.autoLinkNoSuggestions,
          'OK',
        );
        return;
      }
      autoLinkInboundReview = { relativePath, suggestions };
    } catch (err) {
      if (await maybeHandleMissingApiKey(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-link failed: ${msg}`, CONFIRM_KEYS.autoLinkFailed, 'OK');
    } finally {
      autoLinkBusy = false;
    }
  }

  async function handleAutoLinkInboundApply(accepted: AutoLinkInboundSuggestion[]) {
    const review = autoLinkInboundReview;
    if (!review) return;
    autoLinkInboundReview = null;
    try {
      const plain = $state.snapshot(accepted);
      const { applied, skipped } = await withBusy('Applying inbound links\u2026', () =>
        api.refactor.autoLinkInboundApply(review.relativePath, plain),
      );
      if (applied.length === 0 && skipped.length > 0) {
        await showConfirm(
          `Auto-link couldn\u2019t apply any suggestions \u2014 the anchor text changed in one or more source notes. Try again.`,
          CONFIRM_KEYS.autoLinkFailed,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-link failed: ${msg}`, CONFIRM_KEYS.autoLinkFailed, 'OK');
    }
  }

  async function handleAutoLinkApply(accepted: AutoLinkSuggestion[]) {
    const review = autoLinkReview;
    if (!review) return;
    autoLinkReview = null;
    try {
      // Snapshot the suggestions before IPC — they came out of $state, which
      // wraps them in Svelte 5 proxies that structured-clone can't serialize.
      const plain = $state.snapshot(accepted);
      const { applied, skipped } = await withBusy('Applying links\u2026', () =>
        api.refactor.autoLinkApply(review.relativePath, plain),
      );
      if (applied.length === 0 && skipped.length > 0) {
        await showConfirm(
          `Auto-link couldn\u2019t apply any suggestions \u2014 the anchor text changed in the note. Try again.`,
          CONFIRM_KEYS.autoLinkFailed,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-link failed: ${msg}`, CONFIRM_KEYS.autoLinkFailed, 'OK');
    }
  }

  /**
   * Resolve the sidebar selection to the list of .md files a bulk-tag
   * operation should touch. Returns null when nothing applies — the
   * caller surfaces the "no .md files" dialog.
   */
  function bulkTagTargets(fallbackPath?: string, fallbackIsDir?: boolean): string[] | null {
    const sel = sidebar?.getSelectionPaths() ?? [];
    if (sel.length > 0) {
      return expandSelectionToNoteFiles(new Set(sel), notebase.files);
    }
    if (fallbackPath && !fallbackIsDir && fallbackPath.endsWith('.md')) {
      return [fallbackPath];
    }
    if (fallbackPath && fallbackIsDir) {
      return expandSelectionToNoteFiles(new Set([fallbackPath]), notebase.files);
    }
    return null;
  }

  /**
   * Bulk Add Tag. Prompts for a tag name (autocompleted from the
   * thoughtbase vocabulary) and appends it to every .md in the
   * selection. Per-note: noop if the tag is already present
   * (mergeTagsIntoContent handles that). Per-batch: failures are
   * collected into a summary instead of aborting.
   */
  async function handleAddTag(targetPath?: string, targetIsDir?: boolean) {
    if (!notebase.meta) return;
    const targets = bulkTagTargets(targetPath, targetIsDir);
    if (targets === null || targets.length === 0) {
      await showConfirm(
        'The selection contains no .md files to tag.',
        CONFIRM_KEYS.bulkTagNoSelection,
        'OK',
      );
      return;
    }

    let vocab: string[];
    try {
      vocab = (await api.tags.list()).map((t) => t.tag);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Add Tag failed: ${msg}`, CONFIRM_KEYS.bulkTagFailed, 'OK');
      return;
    }

    const raw = await showPrompt(
      `Add tag to ${targets.length} note${targets.length === 1 ? '' : 's'}:`,
      { suggestions: vocab },
    );
    if (!raw) return;
    const tag = raw.trim().toLowerCase();
    if (!tag) return;

    let changed = 0;
    const failures: Array<{ path: string; error: string }> = [];
    for (const path of targets) {
      try {
        const content = await api.notebase.readFile(path);
        const { content: next, addedTags } = mergeTagsIntoContent(content, [tag]);
        if (addedTags.length > 0) {
          await api.notebase.writeFile(path, next);
          changed++;
        }
      } catch (err) {
        failures.push({ path, error: err instanceof Error ? err.message : String(err) });
      }
    }

    sidebar?.refreshTags();
    await reportBulkTagSummary('Add', tag, targets.length, changed, failures);
  }

  /**
   * Bulk Remove Tag. Prompts with the union of tags actually present
   * on the selected .md files (so the autocomplete only offers
   * tags it can plausibly remove). Per-note removal is
   * case-insensitive.
   */
  async function handleRemoveTag(targetPath?: string, targetIsDir?: boolean) {
    if (!notebase.meta) return;
    const targets = bulkTagTargets(targetPath, targetIsDir);
    if (targets === null || targets.length === 0) {
      await showConfirm(
        'The selection contains no .md files to tag.',
        CONFIRM_KEYS.bulkTagNoSelection,
        'OK',
      );
      return;
    }

    // Build the union of tags across the selection. We need the
    // file contents anyway for the writes that follow, but the
    // prompt has to come first — so do a read pass up-front.
    const tagSet = new Set<string>();
    const readFailures: Array<{ path: string; error: string }> = [];
    const cache = new Map<string, string>();
    for (const path of targets) {
      try {
        const content = await api.notebase.readFile(path);
        cache.set(path, content);
        for (const t of extractTagsFromContent(content)) tagSet.add(t);
      } catch (err) {
        readFailures.push({ path, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (tagSet.size === 0) {
      await showConfirm(
        'None of the selected notes have tags to remove.',
        CONFIRM_KEYS.bulkTagNoTagsOnSelection,
        'OK',
      );
      return;
    }
    const suggestions = [...tagSet].sort();
    const raw = await showPrompt(
      `Remove tag from ${targets.length} note${targets.length === 1 ? '' : 's'}:`,
      { suggestions },
    );
    if (!raw) return;
    const tag = raw.trim().toLowerCase();
    if (!tag) return;

    let changed = 0;
    const failures: Array<{ path: string; error: string }> = [...readFailures];
    for (const path of targets) {
      // Skip files that already errored on read — we don't have
      // content to operate on and re-reading would just re-fail.
      if (!cache.has(path)) continue;
      try {
        const content = cache.get(path)!;
        const { content: next, removedTags } = removeTagsFromContent(content, [tag]);
        if (removedTags.length > 0) {
          await api.notebase.writeFile(path, next);
          changed++;
        }
      } catch (err) {
        failures.push({ path, error: err instanceof Error ? err.message : String(err) });
      }
    }

    sidebar?.refreshTags();
    await reportBulkTagSummary('Remove', tag, targets.length, changed, failures);
  }

  /**
   * Toggle the `entrypoint` tag on a single note. Adds it when absent,
   * removes it when present — the menu prefetches the current state to
   * label itself, but the actual decision happens here against the
   * just-read content (the file might have been edited between the
   * prefetch and the click). Refreshes the sidebar Tags panel so the
   * change is visible immediately.
   */
  async function handleToggleEntrypoint(relativePath: string, _currentlyEntrypoint: boolean): Promise<void> {
    if (!notebase.meta) return;
    void _currentlyEntrypoint; // label-only; we re-check from disk
    try {
      const content = await api.notebase.readFile(relativePath);
      const hasIt = extractTagsFromContent(content)
        .some((t) => t.toLowerCase() === ENTRYPOINT_TAG);
      if (hasIt) {
        const { content: next, removedTags } = removeTagsFromContent(content, [ENTRYPOINT_TAG]);
        if (removedTags.length > 0) await api.notebase.writeFile(relativePath, next);
      } else {
        const { content: next, addedTags } = mergeTagsIntoContent(content, [ENTRYPOINT_TAG]);
        if (addedTags.length > 0) await api.notebase.writeFile(relativePath, next);
      }
      sidebar?.refreshTags();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Toggle entrypoint failed: ${msg}`, CONFIRM_KEYS.bulkTagFailed, 'OK');
    }
  }

  async function reportBulkTagSummary(
    op: 'Add' | 'Remove',
    tag: string,
    total: number,
    changed: number,
    failures: Array<{ path: string; error: string }>,
  ): Promise<void> {
    const verb = op === 'Add' ? 'tagged' : 'untagged';
    let msg = `${verb} ${changed} of ${total} note${total === 1 ? '' : 's'} with "${tag}".`;
    if (failures.length > 0) {
      const head = failures.slice(0, 5).map((f) => `• ${f.path}: ${f.error}`).join('\n');
      const tail = failures.length > 5 ? `\n…and ${failures.length - 5} more` : '';
      msg += `\n\nFailed (${failures.length}):\n${head}${tail}`;
    }
    await showConfirm(msg, CONFIRM_KEYS.bulkTagComplete, 'OK');
  }

  /**
   * Selection-driven Format. Resolves "what to format" in priority:
   *
   *   1. Sidebar selection \u2014 every .md under any selected file or
   *      folder (recursing into folders).
   *   2. Active note tab \u2014 fallback when nothing is selected.
   *
   * Multi-file format runs through the bulk formatFolder API on every
   * unique containing folder of the selection. Single-file selection
   * (or active-tab fallback) uses formatContent so the in-memory
   * editor buffer is updated instead of dirty-on-disk drift.
   */
  async function handleFormat() {
    if (!notebase.meta) return;
    const settings = getFormatSettings();

    const selectionPaths = sidebar?.getSelectionPaths() ?? [];
    if (selectionPaths.length > 0) {
      const targets = expandSelectionToNoteFiles(new Set(selectionPaths), notebase.files);
      if (targets.length === 0) {
        await showConfirm(
          'The selection contains no .md files to format.',
          CONFIRM_KEYS.formatFailed,
          'OK',
        );
        return;
      }
      try {
        let totalChanged = 0;
        let totalScanned = 0;
        await withBusy(`Formatting ${targets.length} note${targets.length === 1 ? '' : 's'}\u2026`, async () => {
          for (const path of targets) {
            const result = await api.formatter.formatFile(path, settings);
            totalScanned++;
            if (result.changed) totalChanged++;
          }
        });
        await showConfirm(
          `Formatting complete. Changed ${totalChanged} of ${totalScanned} file${totalScanned === 1 ? '' : 's'}.`,
          CONFIRM_KEYS.formatComplete,
          'OK',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await showConfirm(`Formatting failed: ${msg}`, CONFIRM_KEYS.formatFailed, 'OK');
      }
      return;
    }

    // Fallback: active note tab.
    const tab = editor.activeNoteTab;
    if (!tab) {
      await showConfirm(
        'Open a note (or select notes/folders in the left sidebar) to format.',
        CONFIRM_KEYS.formatFailed,
        'OK',
      );
      return;
    }
    try {
      const result = await withBusy('Formatting\u2026', () =>
        api.formatter.formatContent(tab.content, settings, tab.relativePath),
      );
      if (result !== tab.content) {
        editor.setContent(result);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Formatting failed: ${msg}`, CONFIRM_KEYS.formatFailed, 'OK');
    }
  }

  async function handleBibliography() {
    if (!notebase.meta) return;
    const tab = editor.activeNoteTab;
    if (!tab) {
      await showConfirm(
        'Open a note to insert/update its bibliography.',
        CONFIRM_KEYS.bibliographyFailed,
        'OK',
      );
      return;
    }
    try {
      // Save any unsaved buffer first — the generator reads from disk so
      // citations the user just typed wouldn't otherwise be picked up.
      if (tab.content !== tab.savedContent) await editor.save();
      const result = await withBusy('Generating bibliography…', () =>
        api.bibliography.generate(tab.relativePath),
      );
      const lines: string[] = [];
      if (result.entriesCount === 0 && !result.changed) {
        lines.push('No citations found in this note.');
      } else if (result.entriesCount === 0 && result.changed) {
        lines.push('Removed References section (no remaining citations).');
      } else {
        lines.push(
          `${result.entriesCount} ${result.entriesCount === 1 ? 'entry' : 'entries'} written using ${result.styleId}.`,
        );
      }
      if (result.missingIds.length > 0) {
        lines.push(`Couldn't resolve: ${result.missingIds.join(', ')}.`);
      }
      await showConfirm(lines.join(' '), CONFIRM_KEYS.bibliographyResult, 'OK');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Bibliography failed: ${msg}`, CONFIRM_KEYS.bibliographyFailed, 'OK');
    }
  }

  async function handleIngestUrl() {
    if (!notebase.meta) return;
    const raw = await showPrompt('URL to ingest:');
    if (!raw) return;
    const url = raw.trim();
    if (!url) return;
    try {
      const result = await withBusy('Fetching…', () => api.sources.ingestUrl(url));
      // Wait a beat so the file watcher's indexSource pass finishes before
      // we try to open the source tab — otherwise the detail panel's graph
      // query returns empty and the tab renders as "unknown source."
      setTimeout(() => handleOpenSource(result.sourceId), 150);
      if (result.duplicate) {
        await showConfirm(
          `Already ingested: "${result.title || result.sourceId}". Opened the existing source.`,
          CONFIRM_KEYS.ingestDuplicate,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Ingest failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleExternalDrop(destFolder: string, files: FileList) {
    if (!notebase.meta) return;
    const localPaths: string[] = [];
    for (const f of files) {
      // Electron 32+: `webUtils.getPathForFile` is the supported accessor;
      // `File.path` was deprecated and is removed in Electron 34.
      const p = api.files.getPathForFile(f);
      if (p) localPaths.push(p);
    }
    if (localPaths.length === 0) return;
    try {
      const result = await withBusy('Importing…', () =>
        api.files.dropImport(destFolder, localPaths),
      );
      // Open the first newly-ingested PDF source tab, matching the menu-
      // triggered Ingest PDF flow. setTimeout waits for the watcher to
      // finish reindexing the source so the detail panel has data.
      const openablePdf = result.ingestedPdfs.find((p) => !p.duplicate) ?? result.ingestedPdfs[0];
      if (openablePdf) {
        setTimeout(() => handleOpenSource(openablePdf.sourceId), 150);
      }
      if (result.rejected.length > 0) {
        const lines = result.rejected
          .map((r) => `• ${r.localPath.split('/').pop()} — ${r.reason}`)
          .join('\n');
        await showConfirm(
          `Some files were skipped:\n${lines}`,
          CONFIRM_KEYS.dropImportRejected,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Import failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleImportBibtex() {
    if (!notebase.meta) return;
    try {
      const result = await withBusy('Importing BibTeX…', () => api.sources.importBibtex());
      if (!result) return; // user cancelled the picker
      // Refresh the Sources panel so the new entries are immediately visible.
      sidebar?.refreshSources();
      await refreshSourcesCache();
      const parts: string[] = [
        `Imported: ${result.imported.length}`,
        `Duplicate (skipped): ${result.duplicate.length}`,
      ];
      if (result.failed.length > 0) parts.push(`Failed: ${result.failed.length}`);
      if (result.parseErrors > 0) parts.push(`Parse errors: ${result.parseErrors}`);
      let message = `BibTeX import complete.\n\n${parts.join('\n')}`;
      if (result.failed.length > 0) {
        const preview = result.failed
          .slice(0, 5)
          .map((f) => `  • ${f.key}: ${f.reason}`)
          .join('\n');
        const more = result.failed.length > 5 ? `\n  …and ${result.failed.length - 5} more` : '';
        message += `\n\nFirst failures:\n${preview}${more}`;
      }
      await showConfirm(message, CONFIRM_KEYS.bibtexImportComplete, 'OK');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`BibTeX import failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleImportZoteroRdf() {
    if (!notebase.meta) return;
    try {
      const result = await withBusy('Importing Zotero RDF…', () => api.sources.importZoteroRdf());
      if (!result) return;
      sidebar?.refreshSources();
      await refreshSourcesCache();
      const pdfsLifted = result.imported.filter((i) => i.pdfAttached).length;
      const parts: string[] = [
        `Imported: ${result.imported.length}` + (pdfsLifted > 0 ? ` (${pdfsLifted} with PDF)` : ''),
        `Duplicate (skipped): ${result.duplicate.length}`,
      ];
      if (result.failed.length > 0) parts.push(`Failed: ${result.failed.length}`);
      let message = `Zotero RDF import complete.\n\n${parts.join('\n')}`;
      if (result.failed.length > 0) {
        const preview = result.failed
          .slice(0, 5)
          .map((f) => `  • ${f.subject}: ${f.reason}`)
          .join('\n');
        const more = result.failed.length > 5 ? `\n  …and ${result.failed.length - 5} more` : '';
        message += `\n\nFirst failures:\n${preview}${more}`;
      }
      await showConfirm(message, CONFIRM_KEYS.zoteroRdfImportComplete, 'OK');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Zotero RDF import failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  /**
   * Three-way prompt ("This Window" / "New Window" / "Cancel") wrapped
   * in a promise. Returns 'this' without prompting when no thoughtbase
   * is currently open — same-window is the obviously-right choice for
   * a blank entry screen.
   */
  function askOpenTarget(message: string): Promise<'this' | 'new' | 'cancel'> {
    if (!notebase.meta) return Promise.resolve('this');
    return new Promise((resolve) => {
      openTargetDialog = { message, resolve };
    });
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

  async function handleSaveCellOutput(payload: {
    cellLanguage: string;
    cellCode: string;
    output: import('../shared/compute/types').CellOutput;
    /** Pin to notebook (#244). When true, the saver looks up an
     *  existing derived note for this cell and overwrites it rather
     *  than prompting for a new destination; sets `pin=true` on the
     *  source cell's fence on first pin so subsequent saves reuse
     *  the same destination automatically. */
    pin?: boolean;
  }): Promise<void> {
    if (!notebase.meta) return;
    const sourcePath = editor.activeFilePath;
    if (!sourcePath) return;
    // For a non-pinned "Save as note", prompt for a destination. Pin
    // saves skip the prompt — the backend resolves the destination
    // from the graph (existing derived note for this cell). When the
    // cell is being pinned for the first time AND no derived note
    // exists yet, the backend falls back to the default path.
    let destPath: string | undefined;
    if (!payload.pin) {
      const dest = await showPrompt(
        `Save cell output as note. Path (default: notes/derived/):`,
      );
      if (dest === null) return; // user cancelled
      let trimmed = dest.trim();
      // Add `.md` if the user typed a bare path. The pipeline writes a
      // markdown note unconditionally, so a missing extension would
      // produce a file that `Open` doesn't recognise as a note.
      if (trimmed.length > 0 && !/\.md$/i.test(trimmed)) {
        trimmed += '.md';
      }
      destPath = trimmed.length > 0 ? trimmed : undefined;
    }
    try {
      let result = await api.compute.saveCellOutput({
        sourcePath,
        cellLanguage: payload.cellLanguage,
        cellCode: payload.cellCode,
        output: payload.output,
        destPath,
        pin: payload.pin,
      });
      // Confirm-on-diff (#244): the destination exists with different
      // content. Ask the user before overwriting; on yes, retry with
      // `forceOverwrite: true`. The dialog is intentionally compact
      // — a full diff view is a future polish item.
      if (result.status === 'needs-confirm') {
        const ok = await showConfirm(
          `"${result.derivedPath}" already exists with different content. Overwrite it?`,
          CONFIRM_KEYS.saveCellOutputFailed,
          'Overwrite',
        );
        if (!ok) return;
        result = await api.compute.saveCellOutput({
          sourcePath,
          cellLanguage: payload.cellLanguage,
          cellCode: payload.cellCode,
          output: payload.output,
          destPath: result.derivedPath,
          pin: payload.pin,
          forceOverwrite: true,
        });
        if (result.status !== 'written') return;
      }
      // Refresh the file tree so the new note is selectable, then open it.
      await notebase.refresh();
      setTimeout(() => handleFileSelect(result.derivedPath), 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Save cell output failed: ${msg}`, CONFIRM_KEYS.saveCellOutputFailed, 'OK');
    }
  }

  async function handleIngestPdf() {
    if (!notebase.meta) return;
    try {
      const result = await withBusy('Extracting PDF…', () => api.sources.ingestPdf());
      if (!result) return; // user cancelled the picker
      if (result.duplicate) {
        setTimeout(() => handleOpenSource(result.sourceId), 150);
        await showConfirm(
          `Already ingested: "${result.title || result.sourceId}". Opened the existing source.`,
          CONFIRM_KEYS.ingestDuplicate,
          'OK',
        );
        return;
      }
      if (result.needsOcr) {
        // Scanned PDF — meta.ttl + original.pdf are persisted but
        // body.md is empty until the renderer OCRs (#95). Hold off on
        // opening the source tab until OCR finishes / is skipped, so
        // the user isn't staring at a blank body.
        ocrSession = {
          sourceId: result.sourceId,
          title: result.title,
          pageCount: result.pageCount,
        };
        const bytes = await api.sources.readPdf(result.sourceId);
        ocrPdfBytes = bytes;
        return;
      }
      setTimeout(() => handleOpenSource(result.sourceId), 150);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Ingest failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleOcrDone(pages: string[]) {
    if (!ocrSession) return;
    const { sourceId } = ocrSession;
    ocrSession = null;
    ocrPdfBytes = null;
    try {
      await api.sources.finishPdfOcr(sourceId, pages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`OCR save failed: ${msg}`, CONFIRM_KEYS.ingestPdfFailed, 'OK');
      return;
    }
    setTimeout(() => handleOpenSource(sourceId), 150);
  }

  function handleOcrCancel() {
    // Source + original.pdf stay on disk; body.md is the "OCR pending"
    // placeholder. User can delete the source if they want it gone.
    if (!ocrSession) return;
    const { sourceId } = ocrSession;
    ocrSession = null;
    ocrPdfBytes = null;
    setTimeout(() => handleOpenSource(sourceId), 150);
  }

  /**
   * Right-click a source → "Mine references…" (#106). Runs the LLM
   * mining call, opens a review dialog. User checks the candidates
   * they want, clicks Approve → backend writes the stub files and
   * adds `minerva:references` edges from the parent.
   */
  let mineReviewState = $state<{
    parentId: string;
    parentTitle: string;
    refs: import('../shared/mine-references').ParsedReference[];
  } | null>(null);

  async function handleMineReferences(source: import('../shared/types').SourceMetadata): Promise<void> {
    try {
      const refs = await withBusy('Mining references…', () =>
        api.sources.mineReferences(source.sourceId),
      );
      if (refs.length === 0) {
        await showConfirm(
          'No references the LLM could parse. The body.md may not have a References section, or its formatting is too irregular for first-pass extraction.',
          CONFIRM_KEYS.mineReferencesEmpty,
          'OK',
        );
        return;
      }
      mineReviewState = {
        parentId: source.sourceId,
        parentTitle: source.title ?? source.sourceId,
        refs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Couldn't mine references: ${msg}`, CONFIRM_KEYS.mineReferencesFailed, 'OK');
    }
  }

  async function handleMineReferencesApply(
    accepted: import('../shared/mine-references').ParsedReference[],
  ): Promise<void> {
    const state = mineReviewState;
    mineReviewState = null;
    if (!state) return;
    try {
      const result = await withBusy('Creating stubs…', () =>
        api.sources.createReferenceStubs(state.parentId, accepted),
      );
      await refreshSourcesCache();
      const lines: string[] = [];
      if (result.created.length > 0) lines.push(`Created ${result.created.length} new stub${result.created.length === 1 ? '' : 's'}.`);
      if (result.matchedExisting.length > 0) lines.push(`${result.matchedExisting.length} matched existing sources.`);
      if (result.skipped.length > 0) lines.push(`${result.skipped.length} skipped (id collision).`);
      if (lines.length > 0) {
        await showConfirm(lines.join(' '), CONFIRM_KEYS.mineReferencesResult, 'OK');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Couldn't create stubs: ${msg}`, CONFIRM_KEYS.mineReferencesFailed, 'OK');
    }
  }

  /**
   * Resolve a stub source by searching CrossRef (#107). Two paths:
   * - Top candidate's confidence ≥ `RESOLVE_AUTO_THRESHOLD` → apply
   *   automatically, no picker. The user can still undo via git
   *   if they disagree.
   * - Otherwise → open the disambiguation picker with the top 3.
   */
  let resolveStubState = $state<{
    sourceId: string;
    stubTitle: string;
    candidates: import('../shared/resolve-stub').ResolveCandidate[];
  } | null>(null);

  async function handleResolveStub(sourceId: string): Promise<void> {
    if (!notebase.meta) return;
    let candidates: import('../shared/resolve-stub').ResolveCandidate[];
    try {
      candidates = await withBusy('Searching CrossRef…', () =>
        api.sources.resolveStub(sourceId),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Resolve failed: ${msg}`, CONFIRM_KEYS.resolveStubFailed, 'OK');
      return;
    }
    if (candidates.length === 0) {
      await showConfirm(
        'CrossRef returned no matches. Refine the stub’s title or authors, or ingest the DOI directly.',
        CONFIRM_KEYS.resolveStubEmpty,
        'OK',
      );
      return;
    }
    const top = candidates[0];
    if (top.confidence >= RESOLVE_AUTO_THRESHOLD) {
      await applyResolution(sourceId, top.doi, top.title);
      return;
    }
    // Below threshold — let the user pick.
    const detail = await api.graph.sourceDetail(sourceId);
    resolveStubState = {
      sourceId,
      stubTitle: detail?.metadata.title ?? sourceId,
      candidates,
    };
  }

  async function handleResolveStubApply(doi: string): Promise<void> {
    const state = resolveStubState;
    resolveStubState = null;
    if (!state) return;
    const picked = state.candidates.find((c) => c.doi === doi);
    await applyResolution(state.sourceId, doi, picked?.title ?? state.stubTitle);
  }

  async function applyResolution(sourceId: string, doi: string, newTitle: string): Promise<void> {
    try {
      await withBusy('Applying resolution…', () =>
        api.sources.applyStubResolution(sourceId, doi),
      );
      await refreshSourcesCache();
      await showConfirm(
        `Resolved to "${newTitle}". The source's metadata now reflects the CrossRef record; the source id stays the same so existing citations keep resolving.`,
        CONFIRM_KEYS.resolveStubApplied,
        'OK',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Couldn’t apply resolution: ${msg}`, CONFIRM_KEYS.resolveStubFailed, 'OK');
    }
  }

  /**
   * Click on a bare-DOI link inside the markdown preview (#473).
   * If the DOI already maps to an ingested source, open it. Otherwise
   * offer to ingest — dismissable, keyed so the user can suppress
   * the prompt project-wide once they've made up their mind.
   */
  async function handleDoiClick(doi: string): Promise<void> {
    if (!notebase.meta) return;
    // Normalise — sources store DOIs case-folded; user input might
    // have mixed case from the rendered link text.
    const target = doi.toLowerCase();
    const existing = sourcesCache.find((s) => (s.doi ?? '').toLowerCase() === target);
    if (existing) {
      handleOpenSource(existing.sourceId);
      return;
    }
    const confirmed = await showConfirm(
      `Ingest this DOI as a new source?\n\n${doi}`,
      CONFIRM_KEYS.ingestDoiFromBody,
      'Ingest',
    );
    if (!confirmed) return;
    try {
      const result = await withBusy('Looking up…', () => api.sources.ingestIdentifier(doi));
      setTimeout(() => handleOpenSource(result.sourceId), 150);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Ingest failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleIngestIdentifier() {
    if (!notebase.meta) return;
    const raw = await showPrompt('DOI, arXiv id, or PubMed id:');
    if (!raw) return;
    const identifier = raw.trim();
    if (!identifier) return;
    try {
      const result = await withBusy('Looking up…', () => api.sources.ingestIdentifier(identifier));
      setTimeout(() => handleOpenSource(result.sourceId), 150);
      if (result.duplicate) {
        await showConfirm(
          `Already ingested: "${result.title || result.sourceId}". Opened the existing source.`,
          CONFIRM_KEYS.ingestDuplicate,
          'OK',
        );
      } else if (result.pdfError) {
        await showConfirm(
          `Ingested "${result.title}", but the open-access PDF fetch failed: ${result.pdfError}. The source's bibo:uri points at the canonical record so you can still grab it by hand.`,
          CONFIRM_KEYS.ingestPdfFailed,
          'OK',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Ingest failed: ${msg}`, CONFIRM_KEYS.ingestFailed, 'OK');
    }
  }

  async function handleDecompose(_relativePath: string) {
    if (!notebase.meta) return;
    // Both decompose and crystallize are ThinkingTools (#515), so the
    // editor right-click menu routes through the same tool-prep flow
    // the ToolPanel uses. The `_relativePath` arg is preserved for
    // API symmetry with the other right-click handlers, but the tool
    // gathers its own `fullNote` context against the active editor.
    const ctx = await gatherContext(['fullNote'], editorComponent?.getView());
    await handleOpenConversationFromTool({ toolId: 'research.decompose', context: ctx });
  }

  async function handleCrystallize(_relativePath: string) {
    if (!notebase.meta) return;
    const ctx = await gatherContext(['fullNote'], editorComponent?.getView());
    await handleOpenConversationFromTool({ toolId: 'research.crystallize', context: ctx });
  }


  async function handleAutoTag(relativePath: string) {
    if (!notebase.meta) return;
    try {
      const result = await withBusy('Auto-tagging\u2026', () =>
        api.refactor.autoTag(relativePath),
      );
      if (result.added.length === 0) {
        await showConfirm(
          'No new tags suggested. The note may be too short, too generic, or already well tagged.',
          CONFIRM_KEYS.autoTagNoSuggestions,
          'OK',
        );
      }
      // On success, the NOTEBASE_REWRITTEN listener reloads the note so the
      // user sees the new frontmatter tags appear in the editor.
    } catch (err) {
      if (await maybeHandleMissingApiKey(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-tag failed: ${msg}`, CONFIRM_KEYS.autoTagFailed, 'OK');
    }
  }

  async function handleCopyWithPrompt(relativePath: string) {
    if (!notebase.meta) return;
    const oldName = relativePath.split('/').pop()!;
    const dir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    const rawNewName = await showPrompt('Copy to (new name, or dir/name):');
    if (!rawNewName) return;
    const oldDotIdx = oldName.lastIndexOf('.');
    const oldExt = oldDotIdx > 0 ? oldName.slice(oldDotIdx) : '';
    // Preserve extension when the user didn't type one — mirror handleRename
    // so a copy doesn't silently fall out of the indexed set.
    const trimmed = rawNewName.trim().replace(/^\/+/, '');
    const lastSeg = trimmed.split('/').pop()!;
    const needsExt = !lastSeg.includes('.') && oldExt;
    const finalLast = needsExt ? `${lastSeg}${oldExt}` : lastSeg;
    const segs = trimmed.split('/');
    segs[segs.length - 1] = finalLast;
    const userPath = segs.join('/');
    // If the user typed a path-like value (contains `/`), treat it as
    // project-root relative; otherwise keep it in the source directory.
    const destPath = trimmed.includes('/') ? userPath : (dir ? `${dir}/${userPath}` : userPath);
    if (destPath === relativePath) return;

    let collision = false;
    try {
      await api.notebase.readFile(destPath);
      collision = true;
    } catch { /* expected: dest doesn't exist */ }
    if (collision) {
      await showConfirm(
        `A file already exists at "${destPath}". Copy cancelled.`,
        CONFIRM_KEYS.copyCollision,
        'OK',
      );
      return;
    }

    await api.notebase.copy(relativePath, destPath);
    await notebase.refresh();
  }

  async function handleMoveWithPrompt(relativePath: string) {
    if (!notebase.meta) return;
    const fileName = relativePath.split('/').pop()!;
    const currentDir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    const raw = await showPrompt(`Move "${fileName}" to folder (leave empty for root):`);
    if (raw === null) return;
    const destDir = raw.trim().replace(/^\/+|\/+$/g, '');
    if (destDir === currentDir) return;
    const newPath = destDir ? `${destDir}/${fileName}` : fileName;

    let collision = false;
    try {
      await api.notebase.readFile(newPath);
      collision = true;
    } catch { /* expected: dest doesn't exist */ }
    if (collision) {
      await showConfirm(
        `A file already exists at "${newPath}". Move cancelled.`,
        CONFIRM_KEYS.moveCollision,
        'OK',
      );
      return;
    }

    await handleMove(relativePath, destDir);
  }

  function recordCurrentPosition() {
    const activeTab = editor.activeTab;
    if (!activeTab) return;
    if (activeTab.type === 'note' && editor.activeFilePath) {
      nav.record({ type: 'note', relativePath: editor.activeFilePath, offset: editorComponent?.getOffset() ?? 0 });
    } else if (activeTab.type === 'query') {
      nav.record({ type: 'query', tabId: activeTab.id });
    }
  }

  async function navigateToPosition(pos: import('./lib/stores/navigation.svelte').NavPosition) {
    if (pos.type === 'note') {
      await editor.openFile(pos.relativePath);
      requestAnimationFrame(() => {
        editorComponent?.gotoOffset(pos.offset);
        nav.doneNavigating();
      });
    } else if (pos.type === 'source') {
      editor.openSource(pos.sourceId, { highlightExcerptId: pos.highlightExcerptId });
      nav.doneNavigating();
    } else {
      const idx = editor.tabs.findIndex((t) => t.type === 'query' && t.id === pos.tabId);
      if (idx >= 0) {
        editor.switchTab(idx);
      }
      nav.doneNavigating();
    }
  }

  async function handleNavBack() {
    recordCurrentPosition();
    const pos = nav.goBack();
    if (!pos) return;
    await navigateToPosition(pos);
  }

  async function handleNavForward() {
    recordCurrentPosition();
    const pos = nav.goForward();
    if (!pos) return;
    await navigateToPosition(pos);
  }

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

  async function openConversationWithMessage(message: string) {
    await conversationsStore.openConversationTab({
      notePath: editor.activeFilePath ?? undefined,
      initialMessage: message,
    });
  }

  async function openConversation() {
    await conversationsStore.openFreeform(editor.activeFilePath ?? undefined);
  }

  async function handleOpenConversationFromTool(invocation: { toolId: string; context: ToolContext }) {
    let prep;
    try {
      prep = await api.tools.prepareConversation({
        toolId: invocation.toolId,
        context: invocation.context,
      });
    } catch (err) {
      // The tool's `buildSystemPrompt` may throw with a user-facing
      // explanation (e.g. find-arguments throws "right-click on a
      // claim line first" when no URI was extracted from the cursor).
      // Surface that message as a dialog rather than logging it
      // silently to console.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[tool] prepareConversation failed:', err);
      await showConfirm(msg, CONFIRM_KEYS.toolPrepareFailed, 'OK');
      return;
    }

    const notePath = invocation.context.fullNotePath ?? editor.activeFilePath ?? undefined;
    await conversationsStore.openConversationTab({
      notePath,
      systemPrompt: prep.systemPrompt,
      ...(prep.model ? { model: prep.model } : {}),
      ...(prep.firstMessage ? { initialMessage: prep.firstMessage } : {}),
      ...(prep.requiresTools && prep.requiresTools.length > 0
        ? { extraTools: prep.requiresTools }
        : {}),
    });
  }

  async function handleToolInvoke(toolId: string) {
    const allTools = getAllToolInfos();
    const toolInfo = allTools.find(t => t.id === toolId);
    if (!toolInfo) return;
    const ctx = await gatherContext(toolInfo.context, editorComponent?.getView());
    toolPanel.open(toolInfo, ctx);
    if (!toolInfo.parameters || toolInfo.parameters.length === 0) {
      requestAnimationFrame(() => toolPanelComponent?.startExecution());
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

  function cycleViewMode() {
    if (viewMode === 'source') viewMode = 'preview';
    else if (viewMode === 'preview') viewMode = 'split';
    else viewMode = 'source';
  }

  function handleKeydown(e: KeyboardEvent) {
    // ⌘K (or Ctrl+K) opens the command palette (#463). ⌘⇧P is
    // already bound to cycle view mode, so we use the Linear / VS
    // Code convention instead of Obsidian's ⌘P (which is our quick-
    // open).
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === 'k') {
      if (notebase.meta) {
        e.preventDefault();
        showCommandPalette = !showCommandPalette;
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '[') {
      e.preventDefault();
      void handleNavBack();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ']') {
      e.preventDefault();
      void handleNavForward();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
      e.preventDefault();
      cycleViewMode();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'b') {
      e.preventDefault();
      rightSidebarVisible = !rightSidebarVisible;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
      e.preventDefault();
      handleCycleTheme();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      void handleNewNote();
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'w') {
      if (editor.activeIndex >= 0) {
        e.preventDefault();
        editor.closeTab(editor.activeIndex);
      }
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'p') {
      if (notebase.meta) {
        e.preventDefault();
        showGotoNote = !showGotoNote;
      }
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'g') {
      if (editor.activeTab) {
        e.preventDefault();
        showGotoLine = true;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'q') {
      if (notebase.meta) {
        e.preventDefault();
        editor.openQuery();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'i') {
      e.preventDefault();
      void openConversation();
    }
  }

  onMount(() => {
    initTheme();
    initAppearance();

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
    api.menu.onCycleTheme(() => handleCycleTheme());
    api.menu.onFontIncrease(() => { editorComponent?.changeFontSize(1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; });
    api.menu.onFontDecrease(() => { editorComponent?.changeFontSize(-1); editorFontSize = editorComponent?.currentFontSize() ?? editorFontSize; });
    api.menu.onFontReset(() => { editorComponent?.resetFontSize(); editorFontSize = 14; });
    api.menu.onToggleSidebar(() => { sidebarVisible = !sidebarVisible; });
    api.menu.onToggleRightSidebar(() => { rightSidebarVisible = !rightSidebarVisible; });
    api.menu.onToggleConversations(() => conversationsStore.toggle());
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
    api.menu.onIngestUrl(() => handleIngestUrl());
    api.menu.onIngestIdentifier(() => handleIngestIdentifier());
    api.menu.onIngestPdf(() => handleIngestPdf());
    api.menu.onImportBibtex(() => handleImportBibtex());
    api.menu.onImportZoteroRdf(() => handleImportZoteroRdf());
    api.menu.onExport((id) => { exportDialogFor = id; });

    // Progress updates during a bulk import — rewrites the busy-overlay
    // label in place so the user sees running counts on large imports.
    // One handler per stream; both funnel into the same busyLabel so the
    // user doesn't care which import is running.
    const progressToBusyLabel = ({ done, total, currentTitle }: { done: number; total: number; currentTitle: string }) => {
      if (busyLabel) {
        const short = currentTitle.length > 60 ? currentTitle.slice(0, 57) + '…' : currentTitle;
        busyLabel = `Importing ${done}/${total}: ${short}`;
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
  function countNotes(files: import('../shared/types').NoteFile[]): number {
    let n = 0;
    for (const f of files) {
      if (!f.isDirectory && f.name.endsWith('.md')) n++;
      else if (f.isDirectory && f.children) n += countNotes(f.children);
    }
    return n;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

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
          canPaste={clipboardItems !== null}
        />
      {/if}
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
              onDeleted={handleSourceDeleted}
              onCreateAboutNote={handleNewAboutSourceNote}
              onOpenReference={handleOpenSource}
              onResolveStub={handleResolveStub}
            />
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
          onShowPrompt={showPrompt}
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
  {#if ocrSession && ocrPdfBytes}
    <OcrProgressDialog
      pdfBytes={ocrPdfBytes}
      pageCount={ocrSession.pageCount}
      title={ocrSession.title}
      onDone={handleOcrDone}
      onCancel={handleOcrCancel}
    />
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
  {#if promptDialog}
    <PromptDialog
      message={promptDialog.message}
      suggestions={promptDialog.suggestions ?? []}
      initial={promptDialog.initial ?? ''}
      onConfirm={handlePromptConfirm}
      onCancel={handlePromptCancel}
    />
  {/if}
  {#if mineReviewState}
    <MineReferencesDialog
      parentTitle={mineReviewState.parentTitle}
      refs={mineReviewState.refs}
      onApply={handleMineReferencesApply}
      onCancel={() => { mineReviewState = null; }}
    />
  {/if}
  {#if resolveStubState}
    <ResolveStubDialog
      stubTitle={resolveStubState.stubTitle}
      candidates={resolveStubState.candidates}
      onApply={handleResolveStubApply}
      onCancel={() => { resolveStubState = null; }}
    />
  {/if}
  {#if showCommandPalette}
    <CommandPaletteDialog
      {commands}
      onClose={() => { showCommandPalette = false; }}
    />
  {/if}
  {#if confirmDialog}
    <ConfirmDialog
      message={confirmDialog.message}
      confirmLabel={confirmDialog.confirmLabel}
      hideDontAskAgain={confirmDialog.hideDontAskAgain}
      onConfirm={handleConfirmOk}
      onCancel={handleConfirmCancel}
    />
  {/if}
  {#if openTargetDialog}
    <OpenTargetDialog
      message={openTargetDialog.message}
      onThisWindow={() => { const r = openTargetDialog!.resolve; openTargetDialog = null; r('this'); }}
      onNewWindow={() => { const r = openTargetDialog!.resolve; openTargetDialog = null; r('new'); }}
      onCancel={() => { const r = openTargetDialog!.resolve; openTargetDialog = null; r('cancel'); }}
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
  {#if autoLinkReview}
    <AutoLinkDialog
      suggestions={autoLinkReview.suggestions}
      activeNoteBody={autoLinkReview.activeBody}
      onApply={handleAutoLinkApply}
      onCancel={() => { autoLinkReview = null; }}
    />
  {/if}
  {#if autoLinkInboundReview}
    <AutoLinkInboundDialog
      suggestions={autoLinkInboundReview.suggestions}
      activeStem={autoLinkInboundReview.relativePath.replace(/\.md$/i, '')}
      onApply={handleAutoLinkInboundApply}
      onCancel={() => { autoLinkInboundReview = null; }}
    />
  {/if}
  {#if busyLabel}
    <BusyOverlay label={busyLabel} />
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
