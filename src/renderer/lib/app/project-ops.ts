/**
 * Project / thoughtbase-lifecycle handler cluster extracted from App.svelte
 * (#1084). Covers the new-thoughtbase onboarding journey (#... onboarding),
 * the welcome-note seed, the thoughtbase-guide opener, and the open / new /
 * open-recent thoughtbase flows (including the three-way "this window vs new
 * window" prompt). Bodies are verbatim from App.svelte; the only changes are
 * the store / ctx substitutions for the `showOnboarding` local `$state` that
 * stays in App.
 *
 * Self-contained: the only App-owned surface it touches is `showOnboarding`
 * (via `ctx.setShowOnboarding`) — everything else is store / IPC / shared
 * helpers, so the cluster lifts out cleanly and the call sites (welcome
 * buttons, command palette, native menu) read the destructured names unchanged.
 */
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getEditorStore } from '../stores/editor.svelte';
import { getConversationsStore } from '../stores/conversations.svelte';
import { getDialogStore } from '../stores/dialogs.svelte';
import { slugifyForPath, countNotes } from './text-helpers';
import { IS_MAC } from '../utils/platform';
import { ENTRYPOINT_TAG } from '../../../shared/entrypoint';
import { WELCOME_NOTE_PATH, welcomeNoteContent } from '../../../shared/welcome-note';
import { THOUGHTBASE_DOC_FILENAME, THOUGHTBASE_DOC_TEMPLATE } from '../../../shared/thoughtbase';
import type { OnboardingAnswers } from '../../../shared/onboarding';

export interface ProjectOpsCtx {
  /** Toggle the onboarding modal — the one bit of App-local `$state` this
   *  cluster still drives. */
  setShowOnboarding: (v: boolean) => void;
}

export function createProjectOps(ctx: ProjectOpsCtx) {
  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const conversationsStore = getConversationsStore();
  const dialogs = getDialogStore();

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
    ctx.setShowOnboarding(false);
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
    ctx.setShowOnboarding(false);
    if (dontAskAgain) {
      try { await api.notebase.setOnboardingDismissed(true); }
      catch (e) { console.warn('[onboarding] persist dismiss failed:', e); }
    }
    // Dismissing onboarding (button, Escape, or click-away) leaves an empty
    // thoughtbase with nothing to open. Seed a welcoming default note so the
    // user lands on real prose instead of the bare editor placeholder. Only
    // when still empty — accepting onboarding takes a different path and never
    // reaches here, so this fires exactly for "declined onboarding". `entrypoint`
    // (baked into the body) makes it the note that auto-opens on later loads.
    await maybeSeedWelcomeNote();
  }

  /**
   * Write + open the welcome note when the thoughtbase has no notes yet.
   * Guarded on emptiness so it never clobbers an existing note or duplicates
   * itself. `writeFile` routes through the main-process write pipeline, which
   * indexes the new note (graph + search) exactly like any other save.
   */
  async function maybeSeedWelcomeNote(): Promise<void> {
    if (!notebase.meta) return;
    if (countNotes(notebase.files) > 0) return;
    try {
      await api.notebase.writeFile(WELCOME_NOTE_PATH, welcomeNoteContent(IS_MAC));
      await notebase.refresh();
      await editor.openFile(WELCOME_NOTE_PATH);
    } catch (e) {
      console.warn('[onboarding] welcome note seed failed:', e);
    }
  }

  /**
   * Open the thoughtbase guide (thoughtbase.md), creating it from a template
   * when it doesn't exist yet. The guide is a plain-English description of the
   * thoughtbase, injected into every conversation's system prompt. It's an
   * ordinary root file — excluded only from indexing — so we just open it.
   */
  async function handleEditThoughtbaseDoc(): Promise<void> {
    if (!notebase.meta) return;
    try {
      if (!(await api.notebase.fileExists(THOUGHTBASE_DOC_FILENAME))) {
        await api.notebase.writeFile(THOUGHTBASE_DOC_FILENAME, THOUGHTBASE_DOC_TEMPLATE);
        await notebase.refresh();
      }
      await editor.openFile(THOUGHTBASE_DOC_FILENAME);
    } catch (e) {
      console.warn('[thoughtbase] open/create guide failed:', e);
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
      if (!dismissed) ctx.setShowOnboarding(true);
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

  async function handleInstallTutorial(): Promise<void> {
    // From the welcome screen (nothing open) install straight into this window.
    // If a thoughtbase is already open, offer new-window so the user's current
    // work stays put. The picker + recursive copy + open all happen in main
    // (#1542/#1544); the tutorial ships with content + an `entrypoint` note, so
    // we skip onboarding and just land on Start Here.
    if (notebase.meta) {
      const choice = await askOpenTarget('A thoughtbase is already open in this window. Install the tutorial in:');
      if (choice === 'cancel') return;
      if (choice === 'new') {
        await api.notebase.installTutorialInNewWindow();
        return;
      }
      editor.clear();
    }
    const opened = await notebase.installTutorial();
    if (opened) {
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

  return {
    handleOnboardingAccept,
    handleOnboardingDecline,
    handleEditThoughtbaseDoc,
    maybeShowOnboarding,
    maybeOpenEntrypoints,
    handleOpenThoughtbase,
    handleNewThoughtbase,
    handleInstallTutorial,
    handleOpenRecentThoughtbase,
  };
}
