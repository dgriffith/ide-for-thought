/**
 * The app's one note-preview fetcher for the type views' hovers (#2710):
 * `makeNotePreviewFetcher` over the open thoughtbase's note list and
 * `api.notebase.readFile` — the same resolution, read and snippet as a
 * `[[link]]` hover, so a Kanban card, a timeline event and a map pin preview
 * exactly what a link to the same note does. Created on first use and shared,
 * so its short read cache is too. A read, so a component may call it.
 */
import { api } from '../../ipc/client';
import { getNotebaseStore } from '../../stores/notebase.svelte';
import { flattenNotePaths } from '../../app/text-helpers';
import { makeNotePreviewFetcher, type NotePreviewFetcher } from '../../editor/note-preview';

let fetcher: NotePreviewFetcher | null = null;

export function appNotePreviewFetcher(): NotePreviewFetcher {
  if (!fetcher) {
    const notebase = getNotebaseStore();
    fetcher = makeNotePreviewFetcher({
      getNotePaths: () => flattenNotePaths(notebase.files),
      readNote: (p) => api.notebase.readFile(p),
    });
  }
  return fetcher;
}
