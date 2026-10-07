/**
 * The Properties panel's *Link attendees* matchers (#2612): for each target
 * type a link property on the open note points at (Person, Place, …), that
 * type's instances, and a `NameMatcher` over them, the note list and the
 * alias map. Split out of PropertiesPanel.svelte so the panel holds only the
 * action itself.
 *
 * Reads only (`api.types.instances`), so it may live outside a store under the
 * renderer data-flow rule. Call during component initialisation: it registers
 * an `$effect`.
 */
import { api } from '../../ipc/client';
import { buildNameMatcher, type LinkCandidate, type NameMatcher } from '../../../../shared/objects/link-names';
import type { NoteFileLike } from '../../../../shared/wiki-link-resolver';

export interface LinkNameInputs {
  /** Target type ids worth fetching, joined by `\n` — a string, so the fetch
   *  doesn't re-run on every keystroke while the set is unchanged. */
  targetTypes: string;
  /** Bumped on reindex: a new Person note becomes linkable. */
  revision: number;
  files: NoteFileLike[];
  aliases: Record<string, string>;
}

export function useLinkNameMatchers(inputs: () => LinkNameInputs): { readonly get: (typeId: string) => NameMatcher | undefined } {
  let candidates = $state<Record<string, LinkCandidate[]>>({});

  $effect(() => {
    const { targetTypes, revision } = inputs();
    void revision;
    const ids = targetTypes ? targetTypes.split('\n') : [];
    if (ids.length === 0) { candidates = {}; return; }
    let cancelled = false;
    void Promise.all(ids.map(async (id): Promise<[string, LinkCandidate[]]> => {
      try {
        const r = await api.types.instances(id);
        return [id, r.instances.map((i) => ({ path: i.path, title: i.title }))];
      } catch {
        return [id, []]; // no project / graph not ready — nothing to offer
      }
    })).then((entries) => { if (!cancelled) candidates = Object.fromEntries(entries); });
    return () => { cancelled = true; };
  });

  /** One matcher per target type, rebuilt only when its inputs change. */
  const matchers = $derived.by(() => {
    const { files, aliases } = inputs();
    return new Map<string, NameMatcher>(
      Object.entries(candidates)
        .filter(([, cands]) => cands.length > 0)
        .map(([id, cands]) => [id, buildNameMatcher(cands, files, aliases)]),
    );
  });

  return { get: (typeId: string) => matchers.get(typeId) };
}
