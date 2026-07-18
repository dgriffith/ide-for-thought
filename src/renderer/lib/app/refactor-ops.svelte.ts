/**
 * Refactor-ops handler cluster extracted from App.svelte (#670). Note
 * refactoring (extract / split-by-heading / split-here), the two Auto-link
 * review flows (#auto-link), bulk tag add / remove, entrypoint toggle,
 * selection-driven Format, bibliography generation, and Auto-tag. Bodies are
 * verbatim from App.svelte; the only changes are the store / ctx substitutions
 * for the pieces that used to be inline component refs, local `$state`, or
 * sibling function declarations that stay in App (the missing-API-key flow).
 *
 * Lives in a `.svelte.ts` module because handleAutoLinkApply /
 * handleAutoLinkInboundApply call the `$state.snapshot` rune.
 */
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getEditorStore } from '../stores/editor.svelte';
import { getDialogStore } from '../stores/dialogs.svelte';
import { getBusyStore } from '../stores/busy.svelte';
import { getRefactorFlowStore } from '../stores/refactor-flow.svelte';
import {
  planExtract,
  planSplitHere,
  deriveProposedTitle,
  todayDateString,
} from '../refactor/extract';
import { planSplitByHeading } from '../refactor/split-by-heading';
import { getRefactorSettings } from '../refactor/settings';
import { getFormatSettings } from '../formatter/settings';
import {
  mergeTagsIntoContent,
  removeTagsFromContent,
  extractTagsFromContent,
} from '../../../shared/refactor/auto-tag';
import {
  setPropertyInContent,
  removePropertyFromContent,
  extractPropertyKeysFromContent,
} from '../../../shared/refactor/frontmatter-properties';
import { expandSelectionToNoteFiles } from '../sidebar-tree-utils';
import { ENTRYPOINT_TAG } from '../../../shared/entrypoint';
import { CONFIRM_KEYS } from '../confirm-keys';
import type { AutoLinkSuggestion } from '../../../shared/refactor/auto-link';
import type { AutoLinkInboundSuggestion } from '../../../shared/refactor/auto-link-inbound';

interface EditorRef {
  getSelectionRange: () => { from: number; to: number } | null | undefined;
  getOffset: () => number;
}
interface SidebarRef {
  getSelectionPaths: () => string[];
  refreshTags: () => void;
}
export interface RefactorOpsCtx {
  getSidebar: () => SidebarRef | undefined;
  getEditorComponent: () => EditorRef | undefined;
  maybeHandleMissingApiKey: (err: unknown) => Promise<boolean>;
}

export function createRefactorOps(ctx: RefactorOpsCtx) {
  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const dialogs = getDialogStore();
  const busy = getBusyStore();
  const flow = getRefactorFlowStore();
  const { showPrompt, showConfirm } = dialogs;

  /**
   * After a renderer-initiated bulk write (tag add/remove, entrypoint toggle),
   * sync any affected OPEN note tabs to disk so the visible page reflects the
   * change. `api.notebase.writeFile` suppresses the `rewritten` broadcast that
   * normally drives this (it assumes the writer is the editor saving its own
   * buffer) — so the writer refreshes the views itself, mirroring App's
   * onRewritten flow including the unsaved-edits prompt.
   */
  async function syncOpenTabsToDisk(paths: string[]): Promise<void> {
    for (const path of paths) {
      if (editor.isPathDirty(path)) {
        const keepDisk = await showConfirm(
          `"${path}" is open with unsaved edits. Discard them and load the updated version?`,
          CONFIRM_KEYS.rewriteConflict,
          'Load disk',
        );
        if (!keepDisk) continue;
      }
      await editor.reloadTabFromDisk(path);
    }
  }

  async function resolveTitle(body: string): Promise<string | null> {
    const derived = deriveProposedTitle(body);
    if (derived) return derived;
    return showPrompt('New note name:');
  }

  async function handleExtractSelection() {
    if (!notebase.meta) return;
    const tab = editor.activeNoteTab;
    if (!tab) return;
    const selection = ctx.getEditorComponent()?.getSelectionRange();
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
    ctx.getSidebar()?.refreshTags();
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
    ctx.getSidebar()?.refreshTags();
  }

  async function handleSplitHere() {
    if (!notebase.meta) return;
    const tab = editor.activeNoteTab;
    if (!tab) return;
    const cursor = ctx.getEditorComponent()?.getOffset() ?? 0;
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
    ctx.getSidebar()?.refreshTags();
  }

  async function handleAutoLink(relativePath: string) {
    if (!notebase.meta || flow.autoLinkBusy) return;
    flow.setAutoLinkBusy(true);
    try {
      const { suggestions } = await busy.withBusy('Auto-linking…', () =>
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
      flow.setAutoLinkReview({ relativePath, suggestions, activeBody });
    } catch (err) {
      if (await ctx.maybeHandleMissingApiKey(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-link failed: ${msg}`, CONFIRM_KEYS.autoLinkFailed, 'OK');
    } finally {
      flow.setAutoLinkBusy(false);
    }
  }

  async function handleAutoLinkInbound(relativePath: string) {
    if (!notebase.meta || flow.autoLinkBusy) return;
    flow.setAutoLinkBusy(true);
    try {
      const { suggestions } = await busy.withBusy('Scanning other notes…', () =>
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
      flow.setAutoLinkInboundReview({ relativePath, suggestions });
    } catch (err) {
      if (await ctx.maybeHandleMissingApiKey(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-link failed: ${msg}`, CONFIRM_KEYS.autoLinkFailed, 'OK');
    } finally {
      flow.setAutoLinkBusy(false);
    }
  }

  async function handleAutoLinkInboundApply(accepted: AutoLinkInboundSuggestion[]) {
    const review = flow.autoLinkInboundReview;
    if (!review) return;
    flow.setAutoLinkInboundReview(null);
    try {
      const plain = $state.snapshot(accepted);
      const { applied, skipped } = await busy.withBusy('Applying inbound links…', () =>
        api.refactor.autoLinkInboundApply(review.relativePath, plain),
      );
      if (applied.length === 0 && skipped.length > 0) {
        await showConfirm(
          `Auto-link couldn’t apply any suggestions — the anchor text changed in one or more source notes. Try again.`,
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
    const review = flow.autoLinkReview;
    if (!review) return;
    flow.setAutoLinkReview(null);
    try {
      // Snapshot the suggestions before IPC — they came out of $state, which
      // wraps them in Svelte 5 proxies that structured-clone can't serialize.
      const plain = $state.snapshot(accepted);
      const { applied, skipped } = await busy.withBusy('Applying links…', () =>
        api.refactor.autoLinkApply(review.relativePath, plain),
      );
      if (applied.length === 0 && skipped.length > 0) {
        await showConfirm(
          `Auto-link couldn’t apply any suggestions — the anchor text changed in the note. Try again.`,
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
  function bulkTagTargets(fallbackPath?: string, fallbackIsDir?: boolean, ignoreSelection = false): string[] | null {
    // The editor right-click acts on the note being edited, so it passes
    // `ignoreSelection` to bypass any sidebar multi-selection.
    const sel = ignoreSelection ? [] : (ctx.getSidebar()?.getSelectionPaths() ?? []);
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
  async function handleAddTag(targetPath?: string, targetIsDir?: boolean, opts?: { targetOnly?: boolean }) {
    if (!notebase.meta) return;
    const targets = bulkTagTargets(targetPath, targetIsDir, opts?.targetOnly);
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

    const changedPaths: string[] = [];
    const failures: Array<{ path: string; error: string }> = [];
    for (const path of targets) {
      try {
        const content = await api.notebase.readFile(path);
        const { content: next, addedTags } = mergeTagsIntoContent(content, [tag]);
        if (addedTags.length > 0) {
          await api.notebase.writeFile(path, next);
          changedPaths.push(path);
        }
      } catch (err) {
        failures.push({ path, error: err instanceof Error ? err.message : String(err) });
      }
    }

    ctx.getSidebar()?.refreshTags();
    await syncOpenTabsToDisk(changedPaths);
    await reportBulkTagSummary('Add', tag, targets.length, changedPaths.length, failures);
  }

  /**
   * Bulk Remove Tag. Prompts with the union of tags actually present
   * on the selected .md files (so the autocomplete only offers
   * tags it can plausibly remove). Per-note removal is
   * case-insensitive.
   */
  async function handleRemoveTag(targetPath?: string, targetIsDir?: boolean, opts?: { targetOnly?: boolean }) {
    if (!notebase.meta) return;
    const targets = bulkTagTargets(targetPath, targetIsDir, opts?.targetOnly);
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

    const changedPaths: string[] = [];
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
          changedPaths.push(path);
        }
      } catch (err) {
        failures.push({ path, error: err instanceof Error ? err.message : String(err) });
      }
    }

    ctx.getSidebar()?.refreshTags();
    await syncOpenTabsToDisk(changedPaths);
    await reportBulkTagSummary('Remove', tag, targets.length, changedPaths.length, failures);
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
      let wrote = false;
      if (hasIt) {
        const { content: next, removedTags } = removeTagsFromContent(content, [ENTRYPOINT_TAG]);
        if (removedTags.length > 0) { await api.notebase.writeFile(relativePath, next); wrote = true; }
      } else {
        const { content: next, addedTags } = mergeTagsIntoContent(content, [ENTRYPOINT_TAG]);
        if (addedTags.length > 0) { await api.notebase.writeFile(relativePath, next); wrote = true; }
      }
      ctx.getSidebar()?.refreshTags();
      if (wrote) await syncOpenTabsToDisk([relativePath]);
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
   * Add (or update) a frontmatter property across the selection (or a single
   * target from the editor menu). Prompts for the key — autocompleted from the
   * thoughtbase's frontmatter-key vocabulary — then a value, and upserts
   * `key: value` into each note. `tags` is routed to Add Tag instead.
   */
  async function handleAddProperty(targetPath?: string, targetIsDir?: boolean, opts?: { targetOnly?: boolean }) {
    if (!notebase.meta) return;
    const targets = bulkTagTargets(targetPath, targetIsDir, opts?.targetOnly);
    if (targets === null || targets.length === 0) {
      await showConfirm('The selection contains no .md files to edit.', CONFIRM_KEYS.bulkTagNoSelection, 'OK');
      return;
    }

    let keyVocab: string[] = [];
    try { keyVocab = (await api.graph.frontmatterKeys()).filter((k) => k !== 'tags'); }
    catch { /* vocab is a nicety; the prompt still works without it */ }

    const noun = `${targets.length} note${targets.length === 1 ? '' : 's'}`;
    const rawKey = await showPrompt(`Add property to ${noun} — name:`, { suggestions: keyVocab });
    if (!rawKey) return;
    const key = rawKey.trim();
    if (!key) return;
    if (key === 'tags') {
      await showConfirm('Tags have their own action — use "Add Tag" instead.', CONFIRM_KEYS.bulkPropertyFailed, 'OK');
      return;
    }
    const value = await showPrompt(`Value for "${key}":`);
    if (value === null) return; // cancelled (empty string is allowed)

    const changedPaths: string[] = [];
    const failures: Array<{ path: string; error: string }> = [];
    for (const path of targets) {
      try {
        const content = await api.notebase.readFile(path);
        const { content: next, changed } = setPropertyInContent(content, key, value);
        if (changed) {
          await api.notebase.writeFile(path, next);
          changedPaths.push(path);
        }
      } catch (err) {
        failures.push({ path, error: err instanceof Error ? err.message : String(err) });
      }
    }

    await syncOpenTabsToDisk(changedPaths);
    await reportBulkPropertySummary('Add', key, targets.length, changedPaths.length, failures);
  }

  /**
   * Remove a frontmatter property across the selection (or the editor's note).
   * Prompts with the union of property keys actually present, so it only offers
   * something removable.
   */
  async function handleRemoveProperty(targetPath?: string, targetIsDir?: boolean, opts?: { targetOnly?: boolean }) {
    if (!notebase.meta) return;
    const targets = bulkTagTargets(targetPath, targetIsDir, opts?.targetOnly);
    if (targets === null || targets.length === 0) {
      await showConfirm('The selection contains no .md files to edit.', CONFIRM_KEYS.bulkTagNoSelection, 'OK');
      return;
    }

    const keySet = new Set<string>();
    const readFailures: Array<{ path: string; error: string }> = [];
    const cache = new Map<string, string>();
    for (const path of targets) {
      try {
        const content = await api.notebase.readFile(path);
        cache.set(path, content);
        for (const k of extractPropertyKeysFromContent(content)) keySet.add(k);
      } catch (err) {
        readFailures.push({ path, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (keySet.size === 0) {
      await showConfirm(
        'None of the selected notes have properties to remove.',
        CONFIRM_KEYS.bulkPropertyNoKeysOnSelection,
        'OK',
      );
      return;
    }
    const noun = `${targets.length} note${targets.length === 1 ? '' : 's'}`;
    const rawKey = await showPrompt(`Remove property from ${noun}:`, { suggestions: [...keySet].sort() });
    if (!rawKey) return;
    const key = rawKey.trim();
    if (!key) return;

    const changedPaths: string[] = [];
    const failures: Array<{ path: string; error: string }> = [...readFailures];
    for (const path of targets) {
      if (!cache.has(path)) continue;
      try {
        const { content: next, removed } = removePropertyFromContent(cache.get(path)!, key);
        if (removed) {
          await api.notebase.writeFile(path, next);
          changedPaths.push(path);
        }
      } catch (err) {
        failures.push({ path, error: err instanceof Error ? err.message : String(err) });
      }
    }

    await syncOpenTabsToDisk(changedPaths);
    await reportBulkPropertySummary('Remove', key, targets.length, changedPaths.length, failures);
  }

  async function reportBulkPropertySummary(
    op: 'Add' | 'Remove',
    key: string,
    total: number,
    changed: number,
    failures: Array<{ path: string; error: string }>,
  ): Promise<void> {
    const verb = op === 'Add' ? 'set' : 'removed';
    let msg = `${verb} "${key}" on ${changed} of ${total} note${total === 1 ? '' : 's'}.`;
    if (failures.length > 0) {
      const head = failures.slice(0, 5).map((f) => `• ${f.path}: ${f.error}`).join('\n');
      const tail = failures.length > 5 ? `\n…and ${failures.length - 5} more` : '';
      msg += `\n\nFailed (${failures.length}):\n${head}${tail}`;
    }
    await showConfirm(msg, CONFIRM_KEYS.bulkPropertyComplete, 'OK');
  }

  /**
   * Selection-driven Format. Resolves "what to format" in priority:
   *
   *   1. Sidebar selection — every .md under any selected file or
   *      folder (recursing into folders).
   *   2. Active note tab — fallback when nothing is selected.
   *
   * Multi-file format runs through the bulk formatFolder API on every
   * unique containing folder of the selection. Single-file selection
   * (or active-tab fallback) uses formatContent so the in-memory
   * editor buffer is updated instead of dirty-on-disk drift.
   */
  async function handleFormat() {
    if (!notebase.meta) return;
    const settings = getFormatSettings();

    const selectionPaths = ctx.getSidebar()?.getSelectionPaths() ?? [];
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
        await busy.withBusy(`Formatting ${targets.length} note${targets.length === 1 ? '' : 's'}…`, async () => {
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
      const result = await busy.withBusy('Formatting…', () =>
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
      const result = await busy.withBusy('Generating bibliography…', () =>
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

  async function handleAutoTag(relativePath: string) {
    if (!notebase.meta || flow.autoTagBusy) return;
    flow.setAutoTagBusy(true);
    try {
      // SUGGEST phase (#940): the LLM proposes tags and writes NOTHING. The user
      // reviews them in the dialog; Apply routes through the approval engine.
      const result = await busy.withBusy('Auto-tagging…', () =>
        api.refactor.autoTag(relativePath),
      );
      if (result.added.length === 0) {
        await showConfirm(
          'No new tags suggested. The note may be too short, too generic, or already well tagged.',
          CONFIRM_KEYS.autoTagNoSuggestions,
          'OK',
        );
        return;
      }
      flow.setAutoTagReview({ relativePath, tags: result.added });
    } catch (err) {
      if (await ctx.maybeHandleMissingApiKey(err)) return;
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-tag failed: ${msg}`, CONFIRM_KEYS.autoTagFailed, 'OK');
    } finally {
      flow.setAutoTagBusy(false);
    }
  }

  async function handleAutoTagApply(accepted: string[]) {
    const review = flow.autoTagReview;
    if (!review) return;
    flow.setAutoTagReview(null);
    try {
      // Plain strings, but snapshot for symmetry with the auto-link apply path
      // (the array came out of $state).
      const plain = $state.snapshot(accepted);
      await busy.withBusy('Applying tags…', () =>
        api.refactor.autoTagApply(review.relativePath, plain),
      );
      // On success the note_rewrite approval broadcasts NOTEBASE_REWRITTEN, which
      // reloads the note so the new frontmatter tags appear in the editor.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Auto-tag failed: ${msg}`, CONFIRM_KEYS.autoTagFailed, 'OK');
    }
  }

  return {
    handleExtractSelection, handleSplitByHeading, handleSplitHere,
    handleAutoLink, handleAutoLinkInbound, handleAutoLinkInboundApply, handleAutoLinkApply,
    handleAddTag, handleRemoveTag, handleAddProperty, handleRemoveProperty, handleToggleEntrypoint,
    handleFormat, handleBibliography, handleAutoTag, handleAutoTagApply,
  };
}
