/**
 * Attach an excerpt as evidence for a component (#1073) — grounds / supports /
 * rebuts a claim or argument. Files a PENDING `thought:Proposal` (approval-gated
 * per the maintainer's chosen model): the edge lands in the Proposals panel's
 * diff view and is applied only on approval, appending `this: thought:<role>
 * <claim> .` to the excerpt's meta.ttl (durable, reference-not-copy).
 *
 * A user-initiated action, so no LLM context — `proposeWrite` files the proposal
 * node through the approval engine's own trusted path. An LLM-originated attach
 * would wrap this in `withLLMContext`, but there is no such path yet.
 */
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { proposeWrite } from './approval';
import type { Proposal } from './proposal-types';

export type EvidenceRole = 'grounds' | 'supports' | 'rebuts';
const ROLES: EvidenceRole[] = ['grounds', 'supports', 'rebuts'];

export interface AttachEvidenceResult {
  ok: boolean;
  error?: string;
  proposalUri?: string;
}

export async function proposeExcerptEvidence(
  rootPath: string,
  excerptId: string,
  claimRelativePath: string,
  role: EvidenceRole,
): Promise<AttachEvidenceResult> {
  if (!ROLES.includes(role)) return { ok: false, error: `role must be one of ${ROLES.join(', ')}` };

  const ctx = projectContext(rootPath);
  // Both IRIs come through the graph facade (#2238). This used to call
  // `getState` + `excerptUri` out of `graph/state.ts` to build the second one
  // by hand, which meant holding a `GraphState` it had no other use for.
  const targetUri = graph.noteUriFor(ctx, claimRelativePath);
  const excerptIri = graph.excerptUriFor(ctx, excerptId);
  if (!excerptIri) return { ok: false, error: 'no graph for this project' };
  if (!targetUri) return { ok: false, error: `could not resolve claim note: ${claimRelativePath}` };

  const proposal: Proposal = await proposeWrite(ctx, {
    operationType: 'evidence_link',
    payloads: [{
      kind: 'excerpt-evidence',
      excerptId,
      role,
      targetUri,
      affectsNodeUris: [excerptIri, targetUri],
    }],
    note: `Attach excerpt as ${role} for ${claimRelativePath}`,
    proposedBy: 'user:attach-evidence',
  });
  return { ok: true, proposalUri: proposal.uri };
}
