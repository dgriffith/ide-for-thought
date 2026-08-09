/**
 * Inspection-results subscription (#1795).
 *
 * The checks re-run on their own now — a beat after any save, and on the
 * periodic backstop — so a panel showing results can't assume it caused every
 * change. This owns the `onInspectionsChanged` subscription (main→renderer
 * event subscriptions belong in a store, per the renderer data-flow rule) and
 * exposes a revision the panel reads in an effect.
 *
 * Deliberately its own store rather than a field on the review store: that one
 * is also used by the Proposals panel, and subscribing on construction made an
 * unrelated panel reach for `api.graph` — which broke its test and would have
 * been a real coupling, not just a test problem.
 */
import { api } from '../ipc/client';

let revision = $state(0);
let subscribed = false;

export function getInspectionsStore() {
  if (!subscribed) {
    subscribed = true;
    // Session-lived, like the other store subscriptions — never torn down.
    api.graph.onInspectionsChanged(() => { revision += 1; });
  }
  return {
    /** Bumped when a run finishes anywhere. Read it in an effect to refresh. */
    get revision() { return revision; },
  };
}
