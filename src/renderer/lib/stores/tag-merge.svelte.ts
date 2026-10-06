/**
 * "Merge into tag…" (#2430) — the renderer half of merging one tag into
 * another, or renaming it.
 *
 * Per the data-flow rule (#1086) the mutation (`api.tags.merge`) lives here,
 * not in the Tags panel. The flow: flush autosave → prompt for the target
 * (vocabulary suggestions; a new name is a rename) → count → one confirm with
 * the counts and the undo story → merge. Main broadcasts NOTEBASE_REWRITTEN
 * for the rewritten notes, so open tabs reload through the existing
 * `onRewritten` listener (with its unsaved-edits prompt); this store only
 * bumps `revision` so tag views know to refetch.
 */
import { api } from '../ipc/client';
import { getDialogStore } from './dialogs.svelte';
import { getEditorStore } from './editor.svelte';
import { getBusyStore } from './busy.svelte';
import { CONFIRM_KEYS } from '../confirm-keys';
import { formatCappedList } from '../app/text-helpers';
import { cleanTagInput, type TagMergePreview, type TagMergeResult } from '../../../shared/refactor/merge-tag';

let revision = $state(0);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The confirm text. Exported for tests. */
export function describeTagMerge(from: string, to: string, p: TagMergePreview): string {
  const verb = p.isRename ? 'Rename' : 'Merge';
  const lines = [
    `${verb} #${from} ${p.isRename ? 'to' : 'into'} #${to}: ${plural(p.notes, 'note')}, ${plural(p.sources, 'source')}.`,
  ];
  if (p.nestedTags.length > 0) {
    const shown = p.nestedTags.slice(0, 3).map((t) => `#${t}`).join(', ');
    const more = p.nestedTags.length > 3 ? `, and ${p.nestedTags.length - 3} more` : '';
    lines.push(`Nested tags move with it (${shown}${more}).`);
  }
  if (p.sourcesBodyOnly > 0) {
    lines.push(`${plural(p.sourcesBodyOnly, 'source')} only mention #${from} in captured text, which is left as it is.`);
  }
  lines.push('To undo, restore a note from Local History: each note keeps its previous version. Source tags aren’t in Local History.');
  return lines.join('\n\n');
}

export function getTagMergeStore() {
  const dialogs = getDialogStore();
  const editor = getEditorStore();
  const busy = getBusyStore();

  return {
    /** Bumped after every merge that changed something. */
    get revision(): number { return revision; },

    /**
     * Run the whole "Merge into tag…" flow for `fromTag`. Resolves to the
     * result, or null when the user cancelled at the prompt or the confirm.
     */
    async mergeInteractive(fromTag: string): Promise<TagMergeResult | null> {
      editor.flushAutoSave();
      const vocabulary = await api.tags.allNames();
      const answer = await dialogs.showPrompt(`Merge #${fromTag} into tag (a new name renames it):`, {
        suggestions: vocabulary.filter((t) => t !== fromTag),
      });
      if (answer === null) return null;
      const to = cleanTagInput(answer);
      if (!to || to === fromTag) return null;
      try {
        const preview = await busy.withBusy('Counting tag usages…', () => api.tags.mergePreview(fromTag, to));
        const ok = await dialogs.showConfirm(
          describeTagMerge(fromTag, to, preview),
          CONFIRM_KEYS.mergeTag,
          preview.isRename ? 'Rename' : 'Merge',
        );
        if (!ok) return null;
        const result = await busy.withBusy('Merging tags…', () => api.tags.merge(fromTag, to));
        if (result.notePaths.length > 0 || result.sourceIds.length > 0) revision++;
        if (result.errors.length > 0) {
          await dialogs.showConfirm(
            `Merged #${fromTag} into #${to}, but ${plural(result.errors.length, 'item')} could not be changed:\n\n` +
              formatCappedList(result.errors, (e) => `${e.path}: ${e.error}`),
            CONFIRM_KEYS.mergeTagFailed,
            'OK',
          );
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await dialogs.showConfirm(`Merge tag failed: ${msg}`, CONFIRM_KEYS.mergeTagFailed, 'OK');
        return null;
      }
    },
  };
}
