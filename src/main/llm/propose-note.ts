/**
 * Filing a NEW note as a pending proposal, factored out so the direct CLI path
 * and the routed app path return byte-identical results (#1524).
 *
 * The one difference between the two callers is *store lifecycle*, which is NOT
 * this helper's job:
 *   - CLI (Engine.proposeNote): snapshots `graph.ttl` fresh with `initGraph`
 *     first, since it owns a throwaway in-process store.
 *   - App (substrate server): routes to the app's already-live store — it must
 *     NOT re-init, or it would blow away the in-memory graph the window holds.
 * Both then call `fileNoteProposal` against that ready ctx.
 */
import * as graph from '../graph/index';
import * as approval from './approval';
import type { ProjectContext } from '../project-context-types';

export interface ProposeNoteInput {
  relativePath: string;
  content: string;
  /** One-line summary for the review queue; defaulted from the path if absent. */
  note?: string | undefined;
  /** Provenance — who proposed this. e.g. 'cli' or 'mcp:claude-code'. */
  proposedBy: string;
}

export type ProposeNoteResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * File `input` as a PENDING note proposal against `ctx`'s already-initialized
 * graph store. Routes through the approval gate in LLM context so a regression
 * that wrote directly (bypassing `proposeWrite`) trips the write guard. The
 * proposal is never applied here — a human approves it in Minerva.
 */
export async function fileNoteProposal(
  ctx: ProjectContext,
  input: ProposeNoteInput,
): Promise<ProposeNoteResult> {
  const rel = input.relativePath?.trim();
  if (!rel) return { ok: false, error: 'A relative note path is required.' };
  if (typeof input.content !== 'string' || !input.content.trim()) {
    return { ok: false, error: 'Note content is required.' };
  }

  const summary = input.note?.trim() || `Proposed note: ${rel}`;
  const proposal = await graph.withLLMContext(() =>
    approval.proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [{ kind: 'note', relativePath: rel, content: input.content }],
      note: summary,
      proposedBy: input.proposedBy,
    }),
  );
  await graph.persistGraph(ctx);

  return {
    ok: true,
    data: {
      status: 'pending',
      proposalUri: proposal?.uri ?? null,
      relativePath: rel,
      proposedBy: input.proposedBy,
      note: summary,
      message:
        'Filed as a pending proposal. It is NOT written to the vault until a ' +
        'human reviews and approves it in Minerva (Proposals panel).',
    },
  };
}
