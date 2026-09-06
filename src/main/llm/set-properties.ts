/**
 * Apply side of the `set_properties` tool (#942). The tool itself only emits a
 * ConversationPropertyDraft (trust principle — it never writes); this runs when
 * the user approves that draft, applying each per-note frontmatter patch.
 *
 * The write routes through the approval engine's `note-rewrite` payload (#936)
 * rather than a bare writeAndReindex, so the Trust Principle holds — every
 * applied change leaves a `thought:Proposal` audit record. Per-note proposals
 * (not one atomic bundle) preserve the handler's long-standing non-fatal-per-note
 * behavior: one note failing doesn't roll back the rest of the bundle.
 *
 * Electron-free: returns the rewritten paths for the IPC layer to broadcast
 * (NOTEBASE_REWRITTEN), mirroring the approval engine's own seam.
 */
import * as notebaseFs from '../notebase/fs';
import { withLLMContext } from '../graph/index';
import { projectContext } from '../project-context-types';
import { proposeWrite, approveProposal } from './approval';
import { patchFrontmatterProperties } from '../../shared/refactor/frontmatter-patch';
import type {
  PropertyUpdate,
  PropertyUpdateOutcome,
} from '../../shared/conversation-property-drafts';
import { logger } from '../../shared/logger';

export interface ApplyPropertyUpdatesResult {
  outcomes: PropertyUpdateOutcome[];
  /** Paths overwritten by an approved note_rewrite — the caller broadcasts
   *  NOTEBASE_REWRITTEN so open editors + the Properties panel reload. */
  rewrittenPaths: string[];
}

export async function applyPropertyUpdates(
  rootPath: string,
  updates: PropertyUpdate[],
  conversationId: string,
): Promise<ApplyPropertyUpdatesResult> {
  const ctx = projectContext(rootPath);
  const outcomes: PropertyUpdateOutcome[] = [];
  const rewrittenPaths: string[] = [];

  // Arm the trust guard (#944): a direct graph write below that skips the
  // approval engine trips checkLLMWriteGuard (surfaced per-note as an error
  // outcome via the existing try/catch, which the tests assert against).
  await withLLMContext(async () => {
    for (const u of updates) {
      try {
        if (!u.properties || typeof u.properties !== 'object' || Object.keys(u.properties).length === 0) {
          // Don't silently produce a no-op outcome — that's what hid the original
          // cross-IPC serialization bug. Surface it as an explicit error so the
          // user sees something on the Filed line and the log captures the payload.
          outcomes.push({
            relativePath: u.relativePath,
            changedKeys: [],
            deletedKeys: [],
            error: 'properties payload arrived empty across IPC — frontmatter not written.',
          });
          continue;
        }
        const before = await notebaseFs.readFile(rootPath, u.relativePath);
        const result = patchFrontmatterProperties(before, u.properties);
        if (result.changedKeys.length > 0) {
          // Route through the approval engine. The user already reviewed the
          // property draft card, so approve immediately; a thought:Proposal is
          // still filed as the audit record.
          const proposal = await proposeWrite(ctx, {
            operationType: 'note_rewrite',
            payloads: [{ kind: 'note-rewrite', path: u.relativePath, content: result.content }],
            note: `Set properties on ${u.relativePath}: ${result.changedKeys.join(', ')}`,
            conversationUri: `https://minerva.dev/ontology/thought#conversation/${conversationId}`,
            proposedBy: `llm:conversation:${conversationId}`,
          });
          if (proposal) {
            const applied = await approveProposal(ctx, proposal.uri);
            rewrittenPaths.push(...applied.rewrittenPaths);
          }
        }
        outcomes.push({
          relativePath: u.relativePath,
          changedKeys: result.changedKeys,
          deletedKeys: result.deletedKeys,
        });
      } catch (err) {
        logger('set-properties').warn(`patch failed for`, u.relativePath, err);
        outcomes.push({
          relativePath: u.relativePath,
          changedKeys: [],
          deletedKeys: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  return { outcomes, rewrittenPaths };
}
