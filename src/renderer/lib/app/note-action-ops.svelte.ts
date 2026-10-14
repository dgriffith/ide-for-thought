/**
 * The tag and property actions on an explicit list of notes (#2772, epic
 * #2769) — extracted from refactor-ops (#2783), where each of #2772–#2776 had
 * grown them.
 *
 * Four surfaces share them: the left sidebar (its `handle*` in refactor-ops
 * resolve the sidebar's selection and call these), a type view's row menu
 * (#2773), an embedded view (#2774) and a note named inside a view (#2775) —
 * the last three through `viewNoteActions`, which runs them quietly: a
 * success is announced, not a dialog (#2776).
 *
 * A user edit, not an LLM write: no approval engine.
 */
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getDialogStore } from '../stores/dialogs.svelte';
import { syncOpenTabsToDisk } from '../stores/open-tab-sync';
import { CONFIRM_KEYS } from '../confirm-keys';
import type { OperationFailure } from './text-helpers';
import type { TypeViewNoteActions } from '../components/type-view/note-actions';
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

export interface NoteActionOpsDeps {
  /** The shared bulk-result report: a dialog, or — `quiet` — an announcement. */
  reportBulkSummary: (primary: string, failures: OperationFailure[], confirmKey: string, quiet?: boolean) => Promise<void>;
  /** The type-aware bulk property panel (#2431). */
  bulkProperties: {
    isTypedSelection: (paths: string[]) => Promise<boolean>;
    editProperties: (paths: string[], opts?: { only?: string }) => Promise<void>;
  };
  /** Edit Properties… for a view's selection; `only` narrows it to one field. */
  editProperties: (paths: string[], only?: string) => Promise<void>;
  /** After a tag write: refresh the sidebar's tag list. */
  refreshTags: () => void;
}

export function createNoteActionOps(deps: NoteActionOpsDeps) {
  const notebase = getNotebaseStore();
  const { showPrompt, showConfirm, showAddPropertyDialog } = getDialogStore();

  /**
   * The tag and property actions take an explicit list of notes (#2772):
   * `addTagToNotes`, `removeTagFromNotes`, `addPropertyToNotes`,
   * `removePropertyFromNotes`. A view's menu calls them for its own rows; each
   * sidebar `handle*` in refactor-ops resolves the sidebar's selection and calls
   * the same function, so both run the same prompts, writes and failure reporting. This
   * narrows a caller's paths to the markdown notes those writes edit, once each.
   */
  function markdownTargets(paths: readonly string[]): string[] {
    return [...new Set(paths)].filter((p) => p.endsWith('.md'));
  }

  /** Add Tag on explicit notes — see `markdownTargets`. */
  async function addTagToNotes(paths: readonly string[], opts: { quiet?: boolean } = {}) {
    if (!notebase.meta) return;
    const targets = markdownTargets(paths);
    if (targets.length === 0) {
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
    const failures: OperationFailure[] = [];
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

    deps.refreshTags();
    await syncOpenTabsToDisk(changedPaths);
    await reportBulkTagSummary('Add', tag, targets.length, changedPaths.length, failures, opts.quiet);
  }

  /** Remove Tag on explicit notes — see `markdownTargets`. */
  async function removeTagFromNotes(paths: readonly string[], opts: { tag?: string; quiet?: boolean } = {}) {
    if (!notebase.meta) return;
    const targets = markdownTargets(paths);
    if (targets.length === 0) {
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
    const readFailures: OperationFailure[] = [];
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
    // A view's Remove Tag ▸ submenu has already chosen the tag (#2773).
    const raw = opts.tag ?? await showPrompt(
      `Remove tag from ${targets.length} note${targets.length === 1 ? '' : 's'}:`,
      { suggestions },
    );
    if (!raw) return;
    const tag = raw.trim().toLowerCase();
    if (!tag) return;

    const changedPaths: string[] = [];
    const failures: OperationFailure[] = [...readFailures];
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

    deps.refreshTags();
    await syncOpenTabsToDisk(changedPaths);
    await reportBulkTagSummary('Remove', tag, targets.length, changedPaths.length, failures, opts.quiet);
  }

  async function reportBulkTagSummary(
    op: 'Add' | 'Remove',
    tag: string,
    total: number,
    changed: number,
    failures: OperationFailure[],
    quiet = false,
  ): Promise<void> {
    const verb = op === 'Add' ? 'tagged' : 'untagged';
    await deps.reportBulkSummary(
      `${verb} ${changed} of ${total} note${total === 1 ? '' : 's'} with "${tag}".`,
      failures, CONFIRM_KEYS.bulkTagComplete, quiet,
    );
  }

  /** Add (or set) a property on explicit notes — see `markdownTargets`. */
  async function addPropertyToNotes(paths: readonly string[], opts: { quiet?: boolean } = {}) {
    if (!notebase.meta) return;
    const targets = markdownTargets(paths);
    if (targets.length === 0) {
      await showConfirm('The selection contains no .md files to edit.', CONFIRM_KEYS.bulkTagNoSelection, 'OK');
      return;
    }
    // A typed selection gets the type-aware panel (#2431), which also adds
    // free-form keys — the schema's widgets beat a raw string prompt.
    if (await deps.bulkProperties.isTypedSelection(targets)) { await deps.bulkProperties.editProperties(targets); return; }

    let keyVocab: string[] = [];
    try { keyVocab = (await api.graph.frontmatterKeys()).filter((k) => k !== 'tags'); }
    catch { /* vocab is a nicety; the dialog still works without it */ }

    const noun = `${targets.length} note${targets.length === 1 ? '' : 's'}`;
    // Name + value on one panel (not two sequential prompts).
    const entered = await showAddPropertyDialog(`Add property to ${noun}`, keyVocab);
    if (!entered) return;
    const key = entered.name.trim();
    if (!key) return;
    if (key === 'tags') {
      await showConfirm('Tags have their own action — use "Add Tag" instead.', CONFIRM_KEYS.bulkPropertyFailed, 'OK');
      return;
    }
    const value = entered.value;

    const changedPaths: string[] = [];
    const failures: OperationFailure[] = [];
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
    await reportBulkPropertySummary('Add', key, targets.length, changedPaths.length, failures, opts.quiet);
  }

  /** Remove a property on explicit notes — see `markdownTargets`. */
  async function removePropertyFromNotes(paths: readonly string[], opts: { key?: string; quiet?: boolean } = {}) {
    if (!notebase.meta) return;
    const targets = markdownTargets(paths);
    if (targets.length === 0) {
      await showConfirm('The selection contains no .md files to edit.', CONFIRM_KEYS.bulkTagNoSelection, 'OK');
      return;
    }
    // Same panel (#2431): every field can be cleared, other keys removed — unless
    // a view's Clear Property ▸ submenu has already named the key (#2773).
    if (opts.key === undefined && await deps.bulkProperties.isTypedSelection(targets)) { await deps.bulkProperties.editProperties(targets); return; }

    const keySet = new Set<string>();
    const readFailures: OperationFailure[] = [];
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
    const rawKey = opts.key ?? await showPrompt(`Remove property from ${noun}:`, { suggestions: [...keySet].sort() });
    if (!rawKey) return;
    const key = rawKey.trim();
    if (!key) return;

    const changedPaths: string[] = [];
    const failures: OperationFailure[] = [...readFailures];
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
    await reportBulkPropertySummary('Remove', key, targets.length, changedPaths.length, failures, opts.quiet);
  }

  async function reportBulkPropertySummary(
    op: 'Add' | 'Remove',
    key: string,
    total: number,
    changed: number,
    failures: OperationFailure[],
    quiet = false,
  ): Promise<void> {
    const verb = op === 'Add' ? 'set' : 'removed';
    await deps.reportBulkSummary(
      `${verb} "${key}" on ${changed} of ${total} note${total === 1 ? '' : 's'}.`,
      failures, CONFIRM_KEYS.bulkPropertyComplete, quiet,
    );
  }

  /** What a type view's row menu runs for its selection (#2773). */
  const viewNoteActions: TypeViewNoteActions = {
    editProperties: (paths, only) => { void deps.editProperties(paths, only); },
    // `quiet`: a success is announced, not a dialog (#2776).
    addTag: (paths) => { void addTagToNotes(paths, { quiet: true }); },
    removeTag: (paths, tag) => { void removeTagFromNotes(paths, { quiet: true, ...(tag !== undefined ? { tag } : {}) }); },
    clearProperty: (paths, name) => { void removePropertyFromNotes(paths, { key: name, quiet: true }); },
  };

  return {
    addTagToNotes, removeTagFromNotes, addPropertyToNotes, removePropertyFromNotes, viewNoteActions,
  };
}
