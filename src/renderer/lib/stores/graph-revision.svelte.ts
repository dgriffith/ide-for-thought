/**
 * The graph revision object views re-project against (#2742).
 *
 * Every view — a view tab, an ```object-view embed (#2067), the right
 * sidebar's typed panels — reloads when this number moves. It used to be a
 * counter in `App.svelte` bumped by the editor's save and autosave, so a write
 * that wasn't an editor save never moved it: create a type, then a few objects
 * of it, and no open view showed them until the app restarted and mounted
 * everything fresh. Embeds made it worse, because since #2323 their mount is
 * kept across re-renders and only `revision` refreshes it.
 *
 * Now main says when the graph changed — after ANY note is indexed or removed,
 * coalesced (`ipc/graph-changed-broadcast.ts`) — and this store owns that
 * subscription (main→renderer subscriptions live in stores, per the renderer
 * data-flow rule). Saves index through the same path, so they need no bump of
 * their own: one would only make every open view query twice per autosave.
 */
import { api } from '../ipc/client';

let revision = $state(0);
let subscribed = false;

export function getGraphRevisionStore() {
  if (!subscribed) {
    subscribed = true;
    // Session-lived, like the other store subscriptions — never torn down.
    api.graph.onChanged(() => { revision += 1; });
  }
  return {
    /** Bumped whenever the graph changes. Read it to refresh a projection. */
    get revision() { return revision; },
  };
}
