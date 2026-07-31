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

export interface Proposal {
  uri: string;
  status: string;
  operationType: string;
  note: string;
  proposedBy: string;
  proposedAt: string;
  payloads: unknown[];
}

let proposals = $state<Proposal[]>([]);
/** True once the first list() has resolved — lets a surface distinguish "no
 *  proposals" from "not loaded yet" (e.g. skip a badge flash on boot). */
let loaded = $state(false);

/** Subscriptions are wired exactly once for the app session (module singleton). */
let started = false;

async function refresh(): Promise<void> {
  proposals = (await api.proposals.list()) as Proposal[];
  loaded = true;
}

function start(): void {
  if (started) return;
  started = true;
  // A proposal was filed / approved / rejected / expired — re-list.
  api.proposals.onChanged(() => void refresh());
  // Thoughtbase switched — the whole set changes.
  api.menu.onProjectOpened(() => void refresh());
  void refresh();
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
  };
}
