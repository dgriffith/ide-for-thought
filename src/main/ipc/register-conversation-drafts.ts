/**
 * Conversation draft-filing IPC handlers (#1623 — split out of
 * register-conversation.ts). "Approve" on an inline draft card (propose_notes,
 * propose_sources, set_properties, propose_claims, the note-refactor / reorg /
 * delete / body drafts, propose_compute) files the change through the approval
 * engine and — since the user already reviewed the card — auto-approves it. The
 * Trust Principle still holds: nothing lands without that explicit Approve.
 *
 * Wired alongside registerConversation() in ipc.ts; kept separate because the
 * conversation lifecycle + SEND streaming is its own large surface. Draft-only
 * helpers (conversationProvenance / ensureDraftItems / buildClaimNoteContent)
 * moved here with it.
 */
import { Channels } from '../../shared/channels';
import { broadcast } from './broadcast';
import * as notebaseFs from '../notebase/fs';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { writeAndReindex } from '../notebase/write-pipeline';
import { runWithHistorySource } from '../history';
import { ingestUrl } from '../sources/ingest';
import { ingestIdentifier } from '../sources/ingest-identifier';
import { privilegedFetch } from '../privileged-sites';
import { ttlString } from '../sources/source-meta-write';
import { fileSourceProperties } from '../llm/source-properties';
import { runCell as runComputeCell } from '../compute/registry';
import { computeConsentGuard } from '../compute/consent';
import { recordExecution } from '../compute/audit';
import { buildExcerptTtl } from '../sources/create-excerpt';
import { slugify } from '../../shared/slug';
import { applyPropertyUpdates } from '../llm/set-properties';
import * as approval from '../llm/approval';
import { orderRefactors } from '../notebase/reorg';
import * as conversation from '../llm/conversation';
import {
  formatComputeResultAsContext,
  recordComputeProposalRun,
  buildComputeProposalNoteBlock,
} from './register-compute';
import { withRootPath, withRootPathWin, reindexFile, persistIndexes, hooks } from './helpers';
import { handle } from './typed-ipc';

/** Build a thought:Claim note from an extracted claim (#104). Mirrors the
 *  child-note shape of the Decompose-into-Claims skill: claim metadata in
 *  frontmatter (materialised as thought:* by the indexer), a blockquote of the
 *  supporting passage, a `[[quote::id]]` edge to the excerpt, and a turtle
 *  block declaring rdf:type. */
function buildClaimNoteContent(
  claim: import('../../shared/conversation-claims-drafts').DraftClaim,
  sourceId: string,
): string {
  const y = (s: string): string => JSON.stringify(s); // valid double-quoted YAML scalar
  return [
    '---',
    `title: ${y(claim.text)}`,
    `claim-kind: ${claim.kind}`,
    `source-text: ${y(claim.quote)}`,
    `confidence: ${claim.confidence}`,
    `extracted-from: "[[sources/${sourceId}]]"`,
    'extracted-by: llm:extract-key-claims',
    '---',
    '',
    `# ${claim.text}`,
    '',
    ...claim.quote.split(/\r?\n/).map((l) => `> ${l}`),
    '',
    `[[quote::${claim.excerptId}]]`,
    '',
    '```turtle',
    'this: a thought:Claim .',
    '```',
    '',
  ].join('\n');
}

/**
 * Every draft-filing IPC handler needs a non-empty array of work items
 * (`payloads` / `claims` / `sources` / `updates`) or there is nothing to file.
 * The recurring cause of an empty array here was a Svelte 5 `$state` value sent
 * across IPC without a snapshot (the Proxy serializes to `{}`), so the throw
 * names the field and points at that fix. Returns the validated array so the
 * caller can use it without re-narrowing.
 */
function ensureDraftItems<T>(draft: unknown, field: string, label: string): T[] {
  const items = (draft as Record<string, unknown> | null | undefined)?.[field];
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      `${label}: draft has no ${field} (received ${JSON.stringify(draft).slice(0, 200)}). ` +
      `If this came from a Svelte 5 $state value, snapshot it before sending across IPC.`,
    );
  }
  return items as T[];
}

/** Proposal provenance for a conversation-originated draft: the conversation's
 *  node URI and the `llm:conversation:<id>` proposer tag. Centralised so a
 *  namespace change is one edit, not six (#1619). Spread into `proposeWrite`. */
function conversationProvenance(conversationId: string): { conversationUri: string; proposedBy: string } {
  return {
    conversationUri: `https://minerva.dev/ontology/thought#conversation/${conversationId}`,
    proposedBy: `llm:conversation:${conversationId}`,
  };
}

export function registerConversationDrafts(): void {
  // The user clicked Approve on a propose_notes draft card. We file the
  // bundle through the standard approval engine AND auto-approve it —
  // the user already reviewed the card, a second pending state in the
  // Proposals panel would be redundant. (See conversation-drafts.ts.)
  handle(
    Channels.CONVERSATION_FILE_DRAFT,
    withRootPath(async (rootPath, draft: import('../../shared/conversation-drafts').ConversationDraft) => {
      console.log('[conv] FILE_DRAFT received', {
        draftId: draft?.draftId,
        conversationId: draft?.conversationId,
        payloads: Array.isArray(draft?.payloads) ? draft.payloads.length : 'not-array',
      });
      ensureDraftItems(draft, 'payloads', 'FILE_DRAFT');
      const ctx = projectContext(rootPath);
      const proposal = await approval.proposeWrite(ctx, {
        operationType: 'component_creation',
        payloads: draft.payloads,
        note: draft.note,
        ...conversationProvenance(draft.conversationId),
      });
      let filedPaths: string[] = [];
      if (proposal) {
        const result = await approval.approveProposal(ctx, proposal.uri);
        filedPaths = result.filedPaths;
      }
      return {
        proposalUri: proposal?.uri ?? null,
        applied: true,
        filedPaths,
      };
    }),
  );

  // Approve a refactor draft (#912): file + auto-apply a note-refactor proposal
  // (the user already reviewed the card). The blast radius is recomputed at apply
  // time by planRename, so only fromPath/toPath go onto the payload.
  handle(
    Channels.CONVERSATION_FILE_REFACTOR_DRAFT,
    withRootPath(async (rootPath, draft: import('../../shared/conversation-refactor-drafts').ConversationRefactorDraft) => {
      if (!draft?.fromPath || !draft?.toPath) throw new Error('FILE_REFACTOR_DRAFT: draft is missing fromPath/toPath');
      const ctx = projectContext(rootPath);
      // A folder move (propose_folder_move sets isFolder) files a folder-refactor
      // payload; a single-note move files note-refactor. Both re-plan at apply.
      const proposal = await approval.proposeWrite(ctx, {
        operationType: 'note_refactor',
        payloads: [draft.isFolder
          ? { kind: 'folder-refactor', fromPath: draft.fromPath, toPath: draft.toPath }
          : { kind: 'note-refactor', fromPath: draft.fromPath, toPath: draft.toPath }],
        note: draft.note,
        ...conversationProvenance(draft.conversationId),
      });
      if (proposal) await approval.approveProposal(ctx, proposal.uri);
      return { proposalUri: proposal?.uri ?? null, applied: true };
    }),
  );

  // Approve a reorganization plan (#914): file + apply the SELECTED items as one
  // ordered note-refactor bundle. applyBundle applies in order and rolls the whole
  // bundle back on any failure, so the vault never lands half-reorganized. Each
  // item re-plans at apply time (picking up earlier moves in the same bundle).
  handle(
    Channels.CONVERSATION_FILE_REORG_DRAFT,
    withRootPath(async (
      rootPath,
      draft: import('../../shared/conversation-refactor-drafts').ConversationReorgDraft,
      selected: Array<{ fromPath: string; toPath: string }>,
    ) => {
      if (!Array.isArray(selected) || selected.length === 0) {
        return { proposalUri: null, applied: false };
      }
      const { ordered } = orderRefactors(selected);
      const ctx = projectContext(rootPath);
      // A folder batch files `folder-refactor` payloads — same bundle, same
      // ordered apply and reverse-order rollback, different payload kind.
      const kind = draft.isFolder ? ('folder-refactor' as const) : ('note-refactor' as const);
      const proposal = await approval.proposeWrite(ctx, {
        operationType: 'note_refactor',
        payloads: ordered.map((i) => ({ kind, fromPath: i.fromPath, toPath: i.toPath })),
        note: draft.note,
        ...conversationProvenance(draft.conversationId),
      });
      if (proposal) await approval.approveProposal(ctx, proposal.uri);
      return { proposalUri: proposal?.uri ?? null, applied: true };
    }),
  );

  // Approve a deletion: file + apply the SELECTED notes as one note-delete bundle.
  // applyBundle is atomic — if any unlink fails, the already-deleted notes are
  // restored from their captured pre-images. The user reviewed the card (per-note
  // blast radius), so this auto-approves once the selection comes back.
  handle(
    Channels.CONVERSATION_FILE_DELETE_DRAFT,
    withRootPath(async (
      rootPath,
      draft: import('../../shared/conversation-refactor-drafts').ConversationDeleteDraft,
      selected: string[],
    ) => {
      // Two shapes share this handler, and `selected` means a different thing in
      // each. A FOLDER delete (propose_folder_delete sets folderPaths) is
      // all-or-nothing per folder, so `selected` carries folder paths and each
      // becomes one folder-delete payload. A per-note delete files one
      // note-delete per selected note path.
      const ctx = projectContext(rootPath);
      const folders = draft?.folderPaths ?? [];
      const isFolderDelete = folders.length > 0;
      const picked = Array.isArray(selected) ? selected : [];
      // Intersect rather than trusting the incoming list: a folder delete only
      // ever removes folders the draft itself proposed.
      const chosenFolders = folders.filter((f) => picked.includes(f));
      if ((isFolderDelete ? chosenFolders.length : picked.length) === 0) {
        return { proposalUri: null, applied: false };
      }

      const proposal = await approval.proposeWrite(ctx, {
        operationType: 'note_delete',
        payloads: isFolderDelete
          ? chosenFolders.map((path) => ({ kind: 'folder-delete' as const, path }))
          : picked.map((path) => ({ kind: 'note-delete' as const, path })),
        note: draft.note,
        ...conversationProvenance(draft.conversationId),
      });
      if (proposal) await approval.approveProposal(ctx, proposal.uri);
      return { proposalUri: proposal?.uri ?? null, applied: true };
    }),
  );

  // Counterpart to CONVERSATION_FILE_DELETE_DRAFT for propose_note_body (#937).
  // Files + auto-approves a single note_rewrite proposal (the user already
  // reviewed the before/after diff on the card), then broadcasts
  // NOTEBASE_REWRITTEN for the overwritten path so an open editor reloads the
  // new content — approval.ts stays Electron-free and just returns the paths.
  handle(
    Channels.CONVERSATION_FILE_NOTE_BODY_DRAFT,
    withRootPath(async (
      rootPath,
      draft: import('../../shared/conversation-note-body-drafts').ConversationNoteBodyDraft,
      selected: string[],
    ): Promise<import('../../shared/conversation-note-body-drafts').FileNoteBodyDraftResult> => {
      ensureDraftItems(draft, 'items', 'FILE_NOTE_BODY_DRAFT');
      // The card sends back the paths the user kept ticked. An absent list means
      // "all of them" so a caller that doesn't do selection still works.
      const keep = Array.isArray(selected) && selected.length > 0
        ? new Set(selected)
        : new Set(draft.items.map((i) => i.relativePath));
      const chosen = draft.items.filter((i) => keep.has(i.relativePath));
      if (chosen.length === 0) return { proposalUri: null, applied: false };

      const ctx = projectContext(rootPath);
      // Arm the trust guard (#944): LLM-originated, so a direct write here that
      // skips the approval engine trips checkLLMWriteGuard.
      return graph.withLLMContext(async () => {
        // ONE proposal carrying one `note-rewrite` payload per note. applyBundle
        // applies them in order and rolls the whole bundle back on any failure,
        // so a twenty-note rewrite can't land half-applied.
        const proposal = await approval.proposeWrite(ctx, {
          operationType: 'note_rewrite',
          payloads: chosen.map((i) => ({
            kind: 'note-rewrite' as const,
            path: i.relativePath,
            content: i.afterContent,
          })),
          note: draft.note,
          ...conversationProvenance(draft.conversationId),
        });
        let applied = false;
        if (proposal) {
          const result = await approval.approveProposal(ctx, proposal.uri);
          applied = result.ok;
          hooks.broadcastRewritten(rootPath, result.rewrittenPaths);
        }
        return { proposalUri: proposal?.uri ?? null, applied };
      });
    }),
  );

  // Counterpart to CONVERSATION_FILE_DRAFT for the propose_claims tool (#104).
  // Files, through the approval engine, one bundle per source: a thought:Excerpt
  // node per supporting quote (anchored by char offsets) + a thought:Claim note
  // per claim that quotes its excerpt and carries its confidence. Excerpt
  // payloads go first so the node exists before the note's quotes edge resolves.
  handle(
    Channels.CONVERSATION_FILE_CLAIMS_DRAFT,
    withRootPath(async (
      rootPath,
      draft: import('../../shared/conversation-claims-drafts').ConversationClaimsDraft,
    ): Promise<import('../../shared/conversation-claims-drafts').FileClaimsDraftResult> => {
      const sourceId = draft?.sourceId;
      ensureDraftItems(draft, 'claims', 'FILE_CLAIMS_DRAFT');
      if (!sourceId) {
        throw new Error(
          `FILE_CLAIMS_DRAFT: draft has no sourceId (received ${JSON.stringify(draft).slice(0, 200)}). ` +
          `If this came from a Svelte 5 $state value, snapshot it before sending across IPC.`,
        );
      }
      const ctx = projectContext(rootPath);
      try {
        const payloads: import('../llm/approval').ProposalPayload[] = [];
        const seenExcerpts = new Set<string>();
        const claimPaths: string[] = [];
        const excerptIds: string[] = [];

        draft.claims.forEach((claim, i) => {
          // Excerpt payload (dedupe — two claims may share a quote).
          if (!seenExcerpts.has(claim.excerptId)) {
            seenExcerpts.add(claim.excerptId);
            excerptIds.push(claim.excerptId);
            payloads.push({
              kind: 'excerpt',
              excerptId: claim.excerptId,
              excerptTtl: buildExcerptTtl({
                sourceId,
                citedText: claim.quote,
                charStart: claim.charStart ?? null,
                charEnd: claim.charEnd ?? null,
              }),
            });
          }
          // Claim note payload.
          const slug = slugify(claim.text).slice(0, 48) || 'claim';
          const relativePath = `notes/claims/${sourceId}-${i + 1}-${slug}.md`;
          claimPaths.push(relativePath);
          payloads.push({
            kind: 'note',
            relativePath,
            content: buildClaimNoteContent(claim, sourceId),
          });
        });

        const proposal = await approval.proposeWrite(ctx, {
          operationType: 'component_creation',
          payloads,
          note: draft.note,
          ...conversationProvenance(draft.conversationId),
        });
        if (proposal) await approval.approveProposal(ctx, proposal.uri);

        return { outcome: { sourceId, claimPaths, excerptIds } };
      } catch (err) {
        console.warn('[conv] FILE_CLAIMS_DRAFT failed for', sourceId, err);
        return {
          outcome: {
            sourceId,
            claimPaths: [],
            excerptIds: [],
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  );

  // Counterpart to CONVERSATION_FILE_DRAFT for source-ingest drafts. The
  // user clicked Approve on a propose_sources inline card. We run the
  // existing ingestUrl / ingestIdentifier pipelines per source — same
  // path as the "Ingest URL…" / "Ingest Identifier…" menu items — so
  // LLM-driven and user-driven ingestion share Readability, site
  // handlers, Crossref/arXiv/PubMed lookup, and dedupe. Per-source
  // errors are non-fatal: one failing entry doesn't block the rest of
  // the bundle.
  handle(
    Channels.CONVERSATION_FILE_SOURCE_DRAFT,
    withRootPathWin(async (
      rootPath,
      win,
      draft: import('../../shared/conversation-source-drafts').ConversationSourceDraft,
    ): Promise<import('../../shared/conversation-source-drafts').FileSourceDraftResult> => {
      console.log('[conv] FILE_SOURCE_DRAFT received', {
        draftId: draft?.draftId,
        conversationId: draft?.conversationId,
        sourceCount: Array.isArray(draft?.sources) ? draft.sources.length : 'not-array',
      });
      ensureDraftItems(draft, 'sources', 'FILE_SOURCE_DRAFT');
      const outcomes: import('../../shared/conversation-source-drafts').SourceIngestOutcome[] = [];
      let anyIngested = false;
      for (const src of draft.sources) {
        try {
          if (src.identifier) {
            const result = await ingestIdentifier(rootPath, src.identifier, { fetchImpl: privilegedFetch });
            await reindexFile(rootPath, result.relativePath);
            outcomes.push({
              input: { identifier: src.identifier },
              sourceId: result.sourceId,
              title: result.title,
              duplicate: result.duplicate,
            });
            anyIngested = true;
          } else if (src.url) {
            const result = await ingestUrl(rootPath, src.url, { fetchImpl: privilegedFetch });
            await reindexFile(rootPath, result.relativePath);
            outcomes.push({
              input: { url: src.url },
              sourceId: result.sourceId,
              title: result.title,
              duplicate: result.duplicate,
            });
            anyIngested = true;
          } else {
            // Should not happen — propose_sources validates this — but
            // belt-and-suspenders so we don't crash the whole bundle on
            // a malformed entry that slipped through the IPC boundary.
            outcomes.push({
              input: src,
              error: 'Source entry has neither `identifier` nor `url`.',
            });
          }
        } catch (err) {
          console.warn(`[conv] FILE_SOURCE_DRAFT ingest failed for`, src, err);
          outcomes.push({
            input: src,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (anyIngested) {
        await persistIndexes(rootPath);
        if (!win.isDestroyed()) {
          broadcast(win, Channels.SOURCES_CHANGED);
        }
      }
      return { outcomes };
    }),
  );

  // Counterpart to CONVERSATION_FILE_DRAFT for set_properties bundles.
  // Reads each note, applies its frontmatter patch via
  // `patchFrontmatterProperties`, and writes the result back. Per-note
  // errors are non-fatal — the rest of the bundle still applies.
  handle(
    Channels.CONVERSATION_FILE_PROPERTY_DRAFT,
    withRootPath(async (
      rootPath,
      draft: import('../../shared/conversation-property-drafts').ConversationPropertyDraft,
    ): Promise<import('../../shared/conversation-property-drafts').FilePropertyDraftResult> => {
      console.log('[conv] FILE_PROPERTY_DRAFT received', {
        draftId: draft?.draftId,
        conversationId: draft?.conversationId,
        updateCount: Array.isArray(draft?.updates) ? draft.updates.length : 'not-array',
        // Log the actual properties keys per update — the original
        // silent-failure bug was that this came across as an empty
        // object on every entry, producing no writes. Surface it so a
        // repeat of that hits a useful log line.
        updateKeys: Array.isArray(draft?.updates)
          ? draft.updates.map((u) => ({
              relativePath: u?.relativePath,
              keys: u?.properties ? Object.keys(u.properties) : null,
            }))
          : null,
      });
      ensureDraftItems(draft, 'updates', 'FILE_PROPERTY_DRAFT');
      // Apply each per-note frontmatter patch through the approval engine's
      // note_rewrite payload (#942) — see applyPropertyUpdates. broadcastRewritten
      // reloads open editors + the Properties panel from the rewritten paths.
      const { outcomes, rewrittenPaths } = await applyPropertyUpdates(
        rootPath,
        draft.updates,
        draft.conversationId,
      );
      hooks.broadcastRewritten(rootPath, rewrittenPaths);
      return { outcomes };
    }),
  );

  // Counterpart to CONVERSATION_FILE_PROPERTY_DRAFT for source summaries
  // (#103). Upserts the proposed dc:abstract / thought:tldr into the source's
  // meta.ttl and reindexes — the single human-confirm gate for an
  // LLM-originated source-metadata write.
  handle(
    Channels.CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT,
    withRootPath(async (
      rootPath,
      draft: import('../../shared/conversation-source-property-drafts').ConversationSourcePropertyDraft,
    ): Promise<import('../../shared/conversation-source-property-drafts').FileSourcePropertyDraftResult> => {
      const sourceId = draft?.sourceId;
      if (!sourceId) {
        throw new Error(
          `FILE_SOURCE_PROPERTY_DRAFT: draft has no sourceId (received ${JSON.stringify(draft).slice(0, 200)}). ` +
          `If this came from a Svelte 5 $state value, snapshot it before sending across IPC.`,
        );
      }
      // Mirror the note handler's defensive check: a payload that arrived
      // with neither field (e.g. a serialization slip) should surface, not
      // silently no-op.
      if (!draft.abstract && !draft.tldr) {
        return {
          outcome: {
            sourceId,
            changedPredicates: [],
            error: 'neither abstract nor tldr arrived across IPC — nothing written.',
          },
        };
      }
      try {
        const updates: { predicate: string; value: string }[] = [];
        if (draft.abstract) updates.push({ predicate: 'dc:abstract', value: ttlString(draft.abstract) });
        if (draft.tldr) updates.push({ predicate: 'thought:tldr', value: ttlString(draft.tldr) });
        // Route through the approval engine's source-meta payload (#943) rather
        // than writing meta.ttl directly — leaves a thought:Proposal audit
        // record. The user already reviewed the source-property card.
        const { changedPredicates } = await fileSourceProperties(rootPath, sourceId, updates);
        return { outcome: { sourceId, changedPredicates } };
      } catch (err) {
        console.warn('[conv] FILE_SOURCE_PROPERTY_DRAFT failed for', sourceId, err);
        return {
          outcome: {
            sourceId,
            changedPredicates: [],
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }),
  );

  // Counterpart for propose_compute draft cells (#245). The user
  // clicked Run; we execute via the compute registry, record the
  // ComputeProposal in the graph with thought:executed=true, and
  // append the result to the conversation log so the LLM's next
  // turn sees it as user-role context.
  handle(
    Channels.CONVERSATION_RUN_COMPUTE_DRAFT,
    withRootPath(async (
      rootPath,
      input: import('../../shared/conversation-compute-drafts').RunComputeDraftInput,
    ): Promise<import('../../shared/conversation-compute-drafts').RunComputeDraftResult> => {
      const { draft, editedCode } = input;
      if (!draft || !draft.language || !draft.code) {
        throw new Error('RUN_COMPUTE_DRAFT: draft is missing language or code.');
      }
      const codeToRun = editedCode ?? draft.code;
      console.log(`[conv] RUN_COMPUTE_DRAFT lang=${draft.language} draftId=${draft.draftId}`);
      const ctx = projectContext(rootPath);
      // Enforcement boundary (#1411/#1412): an AI-drafted cell must not run
      // unless the user consented to this exact code — the renderer forces an
      // eyes-on-code review before reaching here.
      const guard = computeConsentGuard(rootPath, draft.language, codeToRun);
      if (guard) return { result: guard };
      const result = await runComputeCell(draft.language, codeToRun, { rootPath });
      // Audit trail (#1413): a conversation-run cell is LLM-authored — the
      // highest-risk provenance, so it's exactly what the log exists to capture.
      recordExecution({ project: rootPath, language: draft.language, code: codeToRun, provenance: 'conversation', result });
      // Append the result to the conversation log as a user-role
      // message so the LLM's next turn sees it as context. Format
      // for legibility — the model parses these like any other
      // user input.
      const contextMessage = formatComputeResultAsContext(draft, codeToRun, result);
      try {
        await conversation.appendMessage(rootPath, draft.conversationId, 'user', contextMessage);
      } catch (err) {
        console.warn('[conv] failed to append compute output to conversation:', err);
      }
      // Record the ComputeProposal in the graph (#245 acceptance
      // criterion: every executed cell has a matching record).
      try {
        recordComputeProposalRun(ctx, draft, codeToRun);
      } catch (err) {
        console.warn('[conv] failed to record ComputeProposal in graph:', err);
      }
      return { result };
    }),
  );

  // Insert a compute-draft cell into a notebook with provenance
  // frontmatter (#245). Default destination is
  // `notes/inbox/conversations/<conversationId>.md`; the user can
  // override via the destinationPath argument.
  handle(
    Channels.CONVERSATION_INSERT_COMPUTE_DRAFT,
    withRootPath(async (
      rootPath,
      input: import('../../shared/conversation-compute-drafts').InsertComputeDraftInput,
    ): Promise<import('../../shared/conversation-compute-drafts').InsertComputeDraftResult> => {
      const { draft, editedCode, destinationPath } = input;
      if (!draft || !draft.language || !draft.code) {
        throw new Error('INSERT_COMPUTE_DRAFT: draft is missing language or code.');
      }
      const codeToInsert = editedCode ?? draft.code;
      const dest = destinationPath?.trim() || `notes/inbox/conversations/${draft.conversationId}.md`;
      // Read existing content (if any) so the cell appends rather
      // than overwrites. Missing-file is the common case for the
      // default destination — fall back to a fresh note.
      let existing: string;
      try {
        existing = await notebaseFs.readFile(rootPath, dest);
      } catch {
        existing = '';
      }
      const block = buildComputeProposalNoteBlock(draft, codeToInsert);
      const next = existing
        ? `${existing.replace(/\s*$/, '')}\n\n${block}\n`
        : `# Conversation: ${draft.conversationId}\n\n${block}\n`;
      await runWithHistorySource({ origin: 'edit', cause: 'Compute cell' }, () =>
        writeAndReindex(rootPath, dest, next, hooks));
      return { destinationPath: dest };
    }),
  );
}
