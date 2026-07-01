/**
 * Apply side of `propose_source_properties` (#943). The tool emits a
 * ConversationSourcePropertyDraft (trust principle — it never writes); this runs
 * when the user approves that draft, upserting the proposed dc:abstract /
 * thought:tldr into the source's meta.ttl.
 *
 * The write routes through the approval engine's `source-meta` payload (#943)
 * rather than a bare setSourceProperties, so the Trust Principle holds — every
 * applied change leaves a `thought:Proposal` audit record. This closes the last
 * of the approval-bypass sites the audit flagged.
 *
 * Lives in `llm/` (not `sources/`) to avoid a cycle: approval.ts imports the
 * source-meta write primitives, and this imports approval.ts.
 */
import { withLLMContext } from '../graph/index';
import { projectContext } from '../project-context-types';
import { proposeWrite, approveProposal } from './approval';
import {
  readMeta,
  sourceMetaPath,
  upsertSingleValuedPredicate,
  type SourceMetaUpdate,
} from '../sources/source-meta-write';

export interface FileSourcePropertiesResult {
  /** Predicates whose value actually changed — echoed to the outcome card. */
  changedPredicates: string[];
}

/**
 * Dry-run the upserts to learn which predicates actually change (so we neither
 * file an empty proposal nor lose the changed-predicate report), then file +
 * approve a single `source-meta` proposal. Recomputes against current meta.ttl.
 */
export async function fileSourceProperties(
  rootPath: string,
  sourceId: string,
  updates: SourceMetaUpdate[],
): Promise<FileSourcePropertiesResult> {
  // Armed with the trust guard (#944).
  return withLLMContext(async () => {
    const before = await readMeta(sourceMetaPath(rootPath, sourceId));
    let probe = before;
    const changedPredicates: string[] = [];
    for (const u of updates) {
      const next = upsertSingleValuedPredicate(probe, u.predicate, u.value);
      if (next !== probe) {
        changedPredicates.push(u.predicate);
        probe = next;
      }
    }
    if (changedPredicates.length === 0) return { changedPredicates: [] };

    const ctx = projectContext(rootPath);
    const proposal = await proposeWrite(ctx, {
      operationType: 'source_properties',
      payloads: [{ kind: 'source-meta', sourceId, updates }],
      note: `Set source properties on ${sourceId}: ${changedPredicates.join(', ')}`,
      proposedBy: 'llm:source-properties',
    });
    if (proposal) await approveProposal(ctx, proposal.uri);
    return { changedPredicates };
  });
}
