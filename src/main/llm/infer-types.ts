/**
 * Type-inference apply helper (#1075) — the migration answer to "a thoughtbase
 * built before types is all untyped notes." Given the LLM's inferred typings
 * (`{ relativePath, typeId }`), files ONE pending `thought:Proposal` per note
 * that sets `type:` in its frontmatter — the same reversible promotion as the
 * single-note "treat this as a Book" command (#1067). The user reviews each in
 * the diff view and approves/rejects per note; nothing is applied silently.
 *
 * Trust Principle: this is LLM-originated, so the whole pass runs inside
 * `withLLMContext` — any graph write that skips the approval engine trips the
 * write guard under test. It mirrors `applyAutoTag` exactly, minus the immediate
 * `approveProposal` (auto-tag's card was pre-reviewed; these land pending).
 *
 * Electron-free: returns plain data for the tool layer, no `app`/IPC imports.
 */
import * as notebaseFs from '../notebase/fs';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { proposeWrite } from './approval';
import { loadTypeCatalog } from '../types/loader';
import { getFrontmatterValues, setFrontmatterProperty } from '../../shared/frontmatter-edit';

export interface TypingAssignment {
  relativePath: string;
  typeId: string;
}
export interface TypingProposalResult {
  /** Notes for which a pending type proposal was filed. */
  proposed: Array<{ relativePath: string; typeId: string }>;
  /** Notes skipped, with a short reason (unknown type, missing note, already that type). */
  skipped: Array<{ relativePath: string; reason: string }>;
}

/**
 * File a pending `type:` proposal for each assignment. `note` is the reviewer-
 * facing rationale carried on every proposal. `conversationId` sets provenance.
 */
export async function proposeNoteTypings(
  rootPath: string,
  conversationId: string,
  assignments: TypingAssignment[],
  note: string,
): Promise<TypingProposalResult> {
  const catalog = await loadTypeCatalog(rootPath);
  const knownTypeIds = new Set(catalog.types.map((t) => t.id));

  // Armed with the trust guard (#944): LLM-originated, so a graph write that
  // bypasses the approval engine here throws under test.
  return graph.withLLMContext(async () => {
    const ctx = projectContext(rootPath);
    const proposed: TypingProposalResult['proposed'] = [];
    const skipped: TypingProposalResult['skipped'] = [];

    for (const { relativePath, typeId } of assignments) {
      if (!knownTypeIds.has(typeId)) {
        // Never invent types not in the registry (out of scope per #1075).
        skipped.push({ relativePath, reason: `unknown type "${typeId}"` });
        continue;
      }
      let content: string;
      try {
        content = await notebaseFs.readFile(rootPath, relativePath);
      } catch {
        skipped.push({ relativePath, reason: 'note not found' });
        continue;
      }
      if (getFrontmatterValues(content).type === typeId) {
        skipped.push({ relativePath, reason: `already type "${typeId}"` });
        continue;
      }

      // The whole promotion: set `type:`, leaving body + existing keys untouched
      // (reversible — remove `type:` → plain note). Frontmatter keys that match
      // the type's declared properties become its property values via the #1063
      // read-back, so no key rewriting is needed.
      const next = setFrontmatterProperty(content, 'type', typeId);
      if (next === content) {
        skipped.push({ relativePath, reason: 'frontmatter could not be edited' });
        continue;
      }

      const proposal = await proposeWrite(ctx, {
        operationType: 'note_rewrite',
        payloads: [{ kind: 'note-rewrite', path: relativePath, content: next }],
        note: `${note} — type ${typeId} for ${relativePath}`,
        conversationUri: `https://minerva.dev/ontology/thought#conversation/${conversationId}`,
        proposedBy: `llm:conversation:${conversationId}`,
      });
      if (proposal) proposed.push({ relativePath, typeId });
    }

    return { proposed, skipped };
  });
}
