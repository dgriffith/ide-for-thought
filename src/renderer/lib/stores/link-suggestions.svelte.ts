/**
 * Applying a suggested wiki-link (#1074 / #1626).
 *
 * The two related-content panels both write a wiki-link the same way:
 *   • RelatedPanel — insert a link to the related note INTO the active note;
 *   • UnlinkedMentions — the inverse: insert a link to the active object INTO
 *     the mentioning note.
 *
 * Per the renderer data-flow rule (#1086) that mutation belongs in a store, not
 * in the component — this is the single, testable path. The backend rewrites the
 * note body and broadcasts NOTEBASE_REWRITTEN, so callers just refetch on the
 * resulting `revision` bump rather than reading anything back from here.
 */
import { api } from '../ipc/client';

export const linkSuggestionsStore = {
  /** Insert `[[target]]` INTO `intoRelPath`. Resolves to whether the note changed. */
  applySuggestedLink(intoRelPath: string, targetRelPath: string): Promise<{ changed: boolean }> {
    return api.refactor.applySuggestedLink(intoRelPath, targetRelPath);
  },
};
