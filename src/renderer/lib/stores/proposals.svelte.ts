/**
 * Proposals store (#1525, epic #1523 — make proposals visible).
 *
 * The single source of truth for "what's pending review." Owns
 * `api.proposals.list()` and — per the renderer data-flow rule (CLAUDE.md) —
 * the `PROPOSALS_CHANGED` subscription, so the left Proposals panel (#1526),
 * the status-bar badge, and the OS dock badge (#1528) all read one reactive
 * list + `pendingCount` instead of each re-fetching on their own.
 *
 * It holds the FULL proposal set (not a status-filtered slice), because
 * `pendingCount` must be global regardless of any panel's current filter — the
 * panel filters this list client-side. It re-fetches on three signals:
 *   1. `PROPOSALS_CHANGED` — a proposal was filed (in-app or routed from a
 *      CLI/MCP client, #1524), approved, rejected, or expired.
 *   2. `project:opened` — switching thoughtbase swaps the whole set.
 *   3. an explicit `refresh()` for first paint.
 *
 * Actions (approve/reject) stay in `review.svelte.ts`; this store is read +
 * subscribe only. Because approve/reject/expire now emit `PROPOSALS_CHANGED`,
 * the list self-updates after a mutation with no manual refresh.
 */
import { api } from '../ipc/client';
import type { Proposal } from '../../../shared/proposals';

// Re-exported so existing importers keep resolving `Proposal` from the store;
// the wire shape now lives in shared/ so the IPC contract can name it (#1632).
export type { Proposal };

let proposals = $state<Proposal[]>([]);
/** True once the first list() has resolved — lets a surface distinguish "no
 *  proposals" from "not loaded yet" (e.g. skip a badge flash on boot). */
let loaded = $state(false);

/** Subscriptions are wired exactly once for the app session (module singleton). */
let started = false;

// ── Arrival detection (#1541) ──────────────────────────────────────────────
// A toast/notification wants the DELTA — which *pending* proposals are newly
// present — not just that the count changed. We diff each re-list against the
// previous pending set here (issue #1541 option (a): keep main untouched).
/** Pending URIs seen at the last refresh, to diff the next one against. */
let prevPending = new Set<string>();
/** Arrival subscribers (the App wires focus-gating + toast/native routing). */
const arrivalListeners = new Set<(arrived: Proposal[]) => void>();
/** Coalesce a burst (a conversation turn / fleet batch files several in quick
 *  succession) into ONE alert: buffer arrivals across refreshes, flush once. */
let arrivalBuffer = new Map<string, Proposal>();
let arrivalTimer: ReturnType<typeof setTimeout> | null = null;

function flushArrivals(): void {
  arrivalTimer = null;
  if (arrivalBuffer.size === 0) return;
  const batch = [...arrivalBuffer.values()];
  arrivalBuffer = new Map();
  for (const cb of arrivalListeners) cb(batch);
}

function bufferArrivals(arrived: Proposal[]): void {
  for (const p of arrived) arrivalBuffer.set(p.uri, p);
  if (arrivalTimer) clearTimeout(arrivalTimer);
  arrivalTimer = setTimeout(flushArrivals, 300);
}

/**
 * Re-list from main. `baseline: true` re-snapshots the pending set WITHOUT
 * emitting arrivals — used for first paint and thoughtbase switches, where the
 * whole set changing is not a stream of "new" proposals. A plain refresh (fired
 * by `PROPOSALS_CHANGED`) diffs against the previous pending set and surfaces
 * any newly-pending proposals as arrivals.
 */
async function refresh(opts?: { baseline?: boolean }): Promise<void> {
  proposals = await api.proposals.list();
  loaded = true;
  const pending = proposals.filter((p) => p.status === 'pending');
  if (!opts?.baseline) {
    const arrived = pending.filter((p) => !prevPending.has(p.uri));
    if (arrived.length > 0) bufferArrivals(arrived);
  }
  prevPending = new Set(pending.map((p) => p.uri));
}

function start(): void {
  if (started) return;
  started = true;
  // A proposal was filed / approved / rejected / expired — re-list + detect
  // arrivals (newly-pending URIs) so a toast/notification can announce them.
  api.proposals.onChanged(() => void refresh());
  // Thoughtbase switched — the whole set changes; re-baseline, don't toast.
  api.menu.onProjectOpened(() => void refresh({ baseline: true }));
  void refresh({ baseline: true });
}

export function getProposalsStore() {
  start();
  return {
    get proposals(): Proposal[] {
      return proposals;
    },
    /** Pending proposals awaiting review — the badge/count everything reads. */
    get pendingCount(): number {
      return proposals.filter((p) => p.status === 'pending').length;
    },
    get loaded(): boolean {
      return loaded;
    },
    /** Force a re-list (first paint / manual). Subscriptions handle the rest. */
    refresh,
    /** Subscribe to coalesced proposal arrivals (newly-pending proposals, #1541).
     *  The callback gets the batch; returns an unsubscribe. */
    onArrival(cb: (arrived: Proposal[]) => void): () => void {
      arrivalListeners.add(cb);
      return () => arrivalListeners.delete(cb);
    },
  };
}
