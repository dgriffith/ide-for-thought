/**
 * Wire contract between a running Minerva app and an out-of-process CLI/MCP
 * client (#1524, epic #1145 — Substrate).
 *
 * When the app opens a thoughtbase it advertises a loopback HTTP endpoint by
 * writing `<root>/.minerva/runtime.json`. A CLI/MCP client reads that advert
 * and POSTs `SubstrateRequest`s to `http://127.0.0.1:<port>/rpc`, so the two
 * ops that need the app to be the single owner of shared state — filing a
 * proposal (single writer on the graph) and semantic search (the process
 * holding the DuckDB lock, #1272) — run *inside* the app instead of racing it.
 *
 * This module is intentionally dependency-light (only the vector-store hit type)
 * so both the app-side server and the client-side router can import it without
 * pulling Electron or the CLI into each other.
 */
import type { RelatedHit } from '../embeddings/vector-store';

/** Advert file, relative to a thoughtbase's `.minerva/` dir. */
export const RUNTIME_FILE = 'runtime.json';

/** Contents of `.minerva/runtime.json` — how a client finds + authenticates to
 *  the running app for this thoughtbase. */
export interface RuntimeAdvert {
  /** PID of the app process. A client treats a dead pid as a stale advert and
   *  falls back to opening state directly (crash-without-cleanup safe). */
  pid: number;
  /** Loopback port the app's substrate server is listening on. */
  port: number;
  /** Per-project random token the client must echo — defence-in-depth on top of
   *  the loopback-only bind. */
  token: string;
  /** ISO timestamp the advert was written. */
  startedAt: string;
}

/** The ops a client may route to the app. Read ops that are safe to run
 *  directly (query/search/sql/grep/read/context) are deliberately NOT proxied. */
export type SubstrateOp = 'proposeNote' | 'semantic';

export interface SubstrateRequest {
  rootPath: string;
  token: string;
  op: SubstrateOp;
  args: Record<string, unknown>;
}

/** Mirror of the Engine's `ExecResult`, so a routed response formats exactly
 *  like the direct one. */
export type SubstrateResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const SEMANTIC_EMPTY_NOTE =
  'No embedded content matched. Semantic search covers notes already embedded ' +
  'by the app; a vault that has never been embedded returns no hits.';

/** Shape a semantic result identically whether it ran direct (CLI) or routed
 *  (app), so `minerva semantic` output is byte-identical either way. */
export function formatSemantic(text: string, hits: RelatedHit[]): { ok: true; data: Record<string, unknown> } {
  const data: Record<string, unknown> = { query: text, hits };
  if (hits.length === 0) data.note = SEMANTIC_EMPTY_NOTE;
  return { ok: true, data };
}
