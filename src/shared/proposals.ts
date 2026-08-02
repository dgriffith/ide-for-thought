/**
 * The wire shape of a proposal as it crosses IPC (`proposal:list` /
 * `proposal:detail`) and reaches the renderer — the serializable, renderer-safe
 * subset of the main-process `Proposal` (src/main/llm/proposal-types.ts). Kept
 * in `shared/` so the typed IPC contract, the preload bridge, and the renderer
 * store all name one type instead of the surface being `unknown` (#1632).
 *
 * `payloads` stays `unknown[]` at this boundary: the payload discriminated union
 * lives in the main process, and the review UI narrows each payload per-kind at
 * render time. Giving the payloads a shared union is a separate, larger effort.
 */
export interface Proposal {
  uri: string;
  /** `pending` | `approved` | `rejected` | `expired` — kept as a string because
   *  the proposals store filters on it client-side. */
  status: string;
  operationType: string;
  note: string;
  proposedBy: string;
  proposedAt: string;
  payloads: unknown[];
}
