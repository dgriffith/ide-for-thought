/**
 * A thoughtbase's own vocabularies (#2788) — Settings → Ontology's state.
 *
 * Owns the folder's statuses and the one import awaiting review. Every call
 * answers with the folder as checked, so the list is replaced from what main
 * says rather than patched here. Import is two steps: `pickImport` checks a
 * file and holds it in main (nothing is saved); `confirmImport` saves exactly
 * what was reviewed.
 */
import { api } from '../ipc/client';
import type { VocabularyImportPreview, VocabularyStatus } from '../../../shared/ontology-vocabularies';

let statuses = $state<VocabularyStatus[]>([]);
let preview = $state<VocabularyImportPreview | null>(null);
let error = $state<string | null>(null);
let busy = $state(false);

async function run(fn: () => Promise<void>): Promise<void> {
  error = null;
  busy = true;
  try {
    await fn();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    busy = false;
  }
}

export function getOntologyStore() {
  return {
    get statuses() { return statuses; },
    get preview() { return preview; },
    get error() { return error; },
    get busy() { return busy; },
    /** Re-read the folder; picks up a file added or edited outside the app. */
    refresh: () => run(async () => { statuses = await api.ontology.list(); }),
    /** Pick a .ttl and show what it declares. Nothing is saved yet. */
    pickImport: () => run(async () => {
      const picked = await api.ontology.pickImport();
      if (picked) preview = picked;
    }),
    confirmImport: () => run(async () => {
      if (!preview) return;
      statuses = await api.ontology.import(preview.id);
      preview = null;
    }),
    cancelImport: () => { preview = null; error = null; },
    remove: (file: string) => run(async () => { statuses = await api.ontology.remove(file); }),
  };
}
