// Shared types for the approval engine. A leaf module (no internal imports
// beyond the ProjectContext type) so policy (`approval.ts`), the apply/rollback
// registry (`apply-dispatch.ts`), and persistence (`proposal-persistence.ts`)
// can all depend on it without a cycle.

// Every LLM-originated write is filed as a pending `thought:Proposal` and
// applied only on human approval — there are no lower-trust tiers. (The old
// `notify_only` / `autonomous` tiers and their orphan operation types —
// tag_addition, staleness_flag, confidence_update, status_change — were removed
// because no write path ever used them; auto-tag, for instance, files a normal
// `note_rewrite` proposal like everything else.)
export type OperationType =
  | 'new_claim'
  | 'evidence_link'
  | 'component_creation'
  | 'note_refactor'
  | 'note_delete'
  | 'note_rewrite'
  | 'source_properties';

/**
 * One side-effect a proposal applies to the thoughtbase. The approval
 * engine dispatches by `kind` at apply time (see `apply-dispatch.ts`); the
 * user sees the whole bundle as one proposal in the diff view and approves /
 * rejects atomically (#418).
 *
 * Most kinds register an apply/rollback handler (`graph-triples`, `note`,
 * `excerpt`, `note-refactor`, `note-delete`, `note-rewrite`, `source-meta`).
 * `source` and `saved-query` are defined but not yet wired — reserved for the
 * Research tools that will need them (#415 wants `source`, the metacognitive
 * cluster wants `saved-query` for "watch this" queries). Apply attempts on an
 * un-registered kind throw so the type stays accurate without forcing the
 * runtime cost up front; the registry's `wiredPayloadKinds()` is the
 * authoritative set of wired kinds.
 */
export type ProposalPayload =
  | {
      kind: 'graph-triples';
      /** Turtle to merge into the project store. Standard prefixes
       *  are auto-injected (same as the legacy single-payload path). */
      turtle: string;
      /** Subjects this turtle introduces. The proposal aggregates
       *  these onto `thought:affectsNode` triples so the trust-
       *  integrity stock query can pin LLM-attributed components to
       *  their approval. */
      affectsNodeUris: string[];
    }
  | {
      kind: 'note';
      /** Project-relative path. On collision, suffixed -2/-3/...; the
       *  resolved path is recorded on the proposal post-apply. */
      relativePath: string;
      content: string;
      /** Optional convenience: emit a single triple linking some
       *  existing node to the new note. Same effect as a separate
       *  `graph-triples` payload but co-located with the note. */
      backlink?: { fromUri: string; predicate: string };
    }
  | {
      kind: 'source';
      sourceId: string;
      metaTtl: string;
      bodyMd?: string;
      original?: { mimeType: string; bytes: Uint8Array };
    }
  | {
      kind: 'source-meta';
      /** Upsert single-valued predicates into an existing source's meta.ttl
       *  (e.g. dc:abstract, thought:tldr — #103/#943). Distinct from the full
       *  `source` ingest kind: this patches specific predicates in place, and
       *  rollback restores the captured pre-image meta.ttl verbatim. `value` is
       *  a ready Turtle term (literal/IRI); null deletes the predicate line. */
      sourceId: string;
      updates: { predicate: string; value: string | null }[];
    }
  | {
      kind: 'excerpt';
      excerptId: string;
      excerptTtl: string;
    }
  | {
      kind: 'saved-query';
      scope: 'project' | 'global';
      name: string;
      description: string;
      query: string;
      language: 'sparql' | 'sql';
      group?: string | null;
    }
  | {
      kind: 'note-refactor';
      /** Move/rename a single note. Inbound links are rewritten by
       *  `renameWithLinkRewrites`; rollback restores captured pre-images (#911). */
      fromPath: string;
      toPath: string;
    }
  | {
      kind: 'note-delete';
      /** Delete a single note. Apply captures the file's content as a
       *  pre-image so rollback can recreate it verbatim. Inbound wiki-links
       *  are intentionally left dangling (matching the manual-delete path),
       *  with the blast radius shown on the review card. */
      path: string;
    }
  | {
      kind: 'folder-refactor';
      /** Move/rename a whole folder. Every note under it moves (relative links
       *  re-relativized) and every inbound wiki-link is rewritten via
       *  `renameWithLinkRewrites` (already folder-aware); rollback moves the
       *  folder back and restores captured pre-images (#911 follow-up). */
      fromPath: string;
      toPath: string;
    }
  | {
      kind: 'folder-delete';
      /** Delete a whole folder and everything under it. Apply captures every
       *  file (notes as text, assets as bytes) as a pre-image so rollback can
       *  recreate the tree verbatim. Inbound wiki-links from outside are left
       *  dangling (matching the note-delete / manual-delete stance), with the
       *  blast radius shown on the review card. */
      path: string;
    }
  | {
      kind: 'note-rewrite';
      /** Overwrite an existing note's full content in place (#936). Apply
       *  captures the prior content as a pre-image so rollback can restore it
       *  verbatim. The note must already exist — this rewrites, it does not
       *  create (that's the `note` kind). The resolved path is surfaced on
       *  ApproveResult.rewrittenPaths so the IPC layer can fire a
       *  NOTEBASE_REWRITTEN broadcast that reloads an open editor. */
      path: string;
      content: string;
    };

/** Narrow ProposalPayload to a single discriminant so the applyXxx helpers
 *  receive the exact payload shape the dispatcher matched. */
export type PayloadOf<K extends ProposalPayload['kind']> = Extract<ProposalPayload, { kind: K }>;

export interface ProposedWrite {
  /** Labels the proposal in the review UI and audit trail. Every write is
   *  filed as a pending proposal regardless of type — this is descriptive
   *  metadata, not a trust tier. */
  operationType: OperationType;
  /** Side effects to apply, in order. Triples-last is the convention
   *  callers should follow; rollback assumes file-system payloads
   *  ran before triples (so a triples-parse failure can undo only
   *  file-system effects). */
  payloads: ProposalPayload[];
  /** Human-readable single-line bundle summary for the proposals UI. */
  note: string;
  conversationUri?: string;
  proposedBy: string;
  expiryDays?: number;
}

export interface Proposal {
  uri: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  operationType: string;
  payloads: ProposalPayload[];
  note: string;
  /** Aggregated across every payload: every URI in graph-triples'
   *  affectsNodeUris plus the resolved note URI of any `note`
   *  payload. Surfaced so the trust-integrity stock query can join
   *  the LLM-attributed components back to this proposal. */
  affectsNodeUris: string[];
  conversationUri?: string | undefined;
  proposedBy: string;
  proposedAt: string;
  autoExpires: string;
}

export interface ApproveResult {
  ok: boolean;
  /** Project-relative paths of files written by `note` payloads in this
   *  bundle, in apply order. Empty when the bundle had no note payloads
   *  or when approve returned `ok: false`. Used by callers that want to
   *  surface "filed: X.md" feedback inline (e.g. the conversation panel)
   *  — collisions are dedup'd at apply time so the resolved path can
   *  differ from `p.relativePath`. */
  filedPaths: string[];
  /** Project-relative paths of existing notes overwritten in place by
   *  `note-rewrite` payloads in this bundle (#936). The IPC caller broadcasts
   *  NOTEBASE_REWRITTEN for these so an open editor reloads the new content —
   *  the approval engine stays Electron-free and only returns the paths. */
  rewrittenPaths: string[];
}

/**
 * Per-payload undo state. `applyBundle` populates this as each payload
 * lands; on failure of a later payload we walk it in reverse.
 */
export interface AppliedRecord {
  kind: ProposalPayload['kind'];
  /** Resolved data the rollback needs (note path, source id, query
   *  filePath, etc). */
  rollbackData: unknown;
}
