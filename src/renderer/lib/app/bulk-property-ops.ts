/**
 * Type-aware bulk property editing (#2431) — the write half.
 *
 * One command for N notes: read the selection, resolve each note's type, build
 * the field model (`shared/objects/bulk-properties.ts`), open the "Edit
 * properties…" dialog, then write ONLY the touched fields to every note through
 * the ordinary write pipeline (`api.notebase.writeFile`, which re-indexes).
 * A note the edits don't change is not written at all, and a note that fails
 * is reported per item (same `OperationFailure[]` summary as Add Tag) without
 * stopping the rest.
 *
 * A user edit, not an LLM write: no approval engine.
 */
import { api } from '../ipc/client';
import { getDialogStore } from '../stores/dialogs.svelte';
import { objectTypesStore } from '../stores/object-types.svelte';
import { effectivePropertyDefs } from '../../../shared/objects/inheritance';
import { applyBulkEdits, buildBulkFieldModel, type BulkNoteInput } from '../../../shared/objects/bulk-properties';
import { logger } from '../../../shared/logger';
import { CONFIRM_KEYS } from '../confirm-keys';
import type { OperationFailure } from './text-helpers';
import type { TypeInfo } from '../../../shared/objects/type-def';

export interface BulkPropertyOpsDeps {
  /** Reload affected open tabs (prompting over unsaved edits). */
  syncOpenTabsToDisk: (paths: string[]) => Promise<void>;
  /** The shared bulk-result dialog (primary line + capped failure list). */
  reportBulkSummary: (primary: string, failures: OperationFailure[], confirmKey: string) => Promise<void>;
  /** After a write: re-project type views, refresh tags/objects panels. */
  onWritten?: (() => void) | undefined;
}

export function createBulkPropertyOps(deps: BulkPropertyOpsDeps) {
  const dialogs = getDialogStore();

  /** Current catalog + note→type map. A stale cache is better than none. */
  async function refreshTypes(): Promise<void> {
    try { await objectTypesStore.refresh(); }
    catch (err) { logger('objects').warn('type catalog refresh failed; using the cached one:', err); }
  }

  /** True when every note in `paths` has a type — the sidebar's Add/Remove
   *  Property then open the type-aware panel instead of a free-text prompt. */
  async function isTypedSelection(paths: string[]): Promise<boolean> {
    if (paths.length === 0) return false;
    await refreshTypes();
    return paths.every((p) => objectTypesStore.typeForNote(p) !== null);
  }

  function defsFor(type: TypeInfo) {
    const byId = new Map<string, TypeInfo>(objectTypesStore.types.map((t) => [t.id, t]));
    if (!byId.has(type.id)) byId.set(type.id, type);
    return effectivePropertyDefs(type.id, byId);
  }

  /** Open the bulk editor for `paths` and write what the user changed. */
  async function editProperties(paths: string[]): Promise<void> {
    const targets = [...new Set(paths)].filter((p) => p.endsWith('.md'));
    if (targets.length === 0) {
      await dialogs.showConfirm('The selection contains no .md files to edit.', CONFIRM_KEYS.bulkTagNoSelection, 'OK');
      return;
    }
    await refreshTypes();

    const notes: BulkNoteInput[] = [];
    const failures: OperationFailure[] = [];
    for (const path of targets) {
      try {
        notes.push({ path, content: await api.notebase.readFile(path), type: objectTypesStore.typeForNote(path) });
      } catch (err) {
        failures.push({ path, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (notes.length === 0) {
      await deps.reportBulkSummary('Couldn’t read any of the selected notes.', failures, CONFIRM_KEYS.bulkPropertyComplete);
      return;
    }

    let tagVocab: string[] = [];
    try { tagVocab = (await api.tags.list()).map((t) => t.tag); }
    catch { /* autocomplete is a nicety */ }

    const model = buildBulkFieldModel(notes, defsFor);
    const edits = await dialogs.showBulkPropertiesDialog(model, tagVocab);
    if (!edits || edits.length === 0) return;

    const changed: string[] = [];
    for (const note of notes) {
      const result = applyBulkEdits(note.content, edits);
      if (result === null) {
        failures.push({ path: note.path, error: 'frontmatter has a YAML error' });
        continue;
      }
      if (!result.changed) continue;
      try {
        await api.notebase.writeFile(note.path, result.content);
        changed.push(note.path);
      } catch (err) {
        failures.push({ path: note.path, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (changed.length > 0) deps.onWritten?.();
    await deps.syncOpenTabsToDisk(changed);
    // The table already shows the result; a summary is only worth a dialog
    // when something didn't land.
    if (failures.length > 0) {
      const total = targets.length;
      await deps.reportBulkSummary(
        `Updated ${changed.length} of ${total} note${total === 1 ? '' : 's'}.`,
        failures, CONFIRM_KEYS.bulkPropertyComplete,
      );
    }
  }

  return { editProperties, isTypedSelection };
}
