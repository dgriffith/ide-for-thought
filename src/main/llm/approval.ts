import * as $rdf from 'rdflib';
import * as graph from '../graph/index';
import * as notebaseFs from '../notebase/fs';
import * as search from '../search/index';
import * as vectors from '../embeddings/vector-store';
import { markPathHandled } from '../notebase/path-dedup';
import { planRename, renameWithLinkRewrites } from '../notebase/rename';
import { setSourceProperties, readMeta, sourceMetaPath, restoreSourceMeta } from '../sources/source-meta-write';
import type { ProjectContext } from '../project-context-types';
import { escapeTurtleLiteral } from './turtle';

// ── Types ──────────────────────────────────────────────────────────────────

export type ApprovalTier = 'requires_approval' | 'notify_only' | 'autonomous';

export type OperationType =
  | 'new_claim'
  | 'evidence_link'
  | 'confidence_update'
  | 'tag_addition'
  | 'staleness_flag'
  | 'component_creation'
  | 'status_change'
  | 'note_refactor'
  | 'note_delete'
  | 'note_rewrite'
  | 'source_properties';

/**
 * One side-effect a proposal applies to the thoughtbase. The approval
 * engine dispatches by `kind` at apply time; the user sees the whole
 * bundle as one proposal in the diff view and approves / rejects
 * atomically (#418).
 *
 * Most kinds are wired to a dispatcher (`graph-triples`, `note`,
 * `excerpt`, `note-refactor`, `note-delete`, `note-rewrite`). `source`
 * and `saved-query` are defined but not yet wired — reserved for the
 * Research tools that will need them (#415 wants `source`, the
 * metacognitive cluster wants `saved-query` for "watch this" queries).
 * Apply attempts on an un-wired kind throw `NotImplementedError` so the
 * type stays accurate without forcing the runtime cost up front; see
 * `WIRED_PAYLOAD_KINDS` for the authoritative set.
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

export interface ProposedWrite {
  /** Drives approval-tier policy lookup. */
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
  conversationUri?: string;
  proposedBy: string;
  proposedAt: string;
  autoExpires: string;
}

// ── Default Policy ─────────────────────────────────────────────────────────

const DEFAULT_POLICY: Record<OperationType, ApprovalTier> = {
  new_claim: 'requires_approval',
  evidence_link: 'requires_approval',
  component_creation: 'requires_approval',
  confidence_update: 'notify_only',
  status_change: 'notify_only',
  tag_addition: 'autonomous',
  staleness_flag: 'autonomous',
  // A move/rename restructures the vault + rewrites links across notes — always
  // reviewed (#911).
  note_refactor: 'requires_approval',
  // Deleting a note is destructive — always reviewed, never autonomous.
  note_delete: 'requires_approval',
  // Rewriting a note's body in place replaces human-authored content — always
  // reviewed via the diff card (#936).
  note_rewrite: 'requires_approval',
  // Upserting LLM-proposed source metadata (abstract / TL;DR) — reviewed via the
  // source-property card (#943).
  source_properties: 'requires_approval',
};

let policyOverrides: Partial<Record<OperationType, ApprovalTier>> = {};

export function getApprovalTier(operationType: OperationType): ApprovalTier {
  return policyOverrides[operationType] ?? DEFAULT_POLICY[operationType] ?? 'requires_approval';
}

export function setPolicy(operationType: OperationType, tier: ApprovalTier): void {
  policyOverrides[operationType] = tier;
}

export function resetPolicy(): void {
  policyOverrides = {};
}

// ── Proposal Management ────────────────────────────────────────────────────

const THOUGHT = 'https://minerva.dev/ontology/thought#';

function proposalUri(): string {
  return `${THOUGHT}proposal/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Aggregate every URI a bundle introduces. graph-triples carry their
 *  own list; `note` payloads are translated to the note's IRI. */
function collectAffectsNodes(ctx: ProjectContext, payloads: ProposalPayload[]): string[] {
  const out = new Set<string>();
  for (const p of payloads) {
    if (p.kind === 'graph-triples') {
      for (const u of p.affectsNodeUris) out.add(u);
    } else if (p.kind === 'note') {
      const uri = graph.noteUriFor(ctx, p.relativePath);
      if (uri) out.add(uri);
    } else if (p.kind === 'note-rewrite') {
      // The rewritten note already exists, so it has a stable IRI. Tie it to
      // the proposal so the trust-integrity query can join an LLM-attributed
      // rewrite back to its approval, and so an established-note rewrite is
      // covered by the escalation check (#936).
      const uri = graph.noteUriFor(ctx, p.path);
      if (uri) out.add(uri);
    }
  }
  return [...out];
}

/**
 * The Trust Principle's established-node escalation (#656): a write that
 * touches any human-vetted (`thought:hasStatus thought:established`) node
 * escalates to `requires_approval` regardless of its operation type — so the
 * LLM can't silently re-tag, flag, or otherwise mutate an established claim
 * via an `autonomous`/`notify_only` op. Returns true if any of `uris` is
 * established.
 */
async function anyNodeEstablished(ctx: ProjectContext, uris: string[]): Promise<boolean> {
  if (uris.length === 0) return false;
  const values = uris.map((u) => `<${u}>`).join(' ');
  const r = await graph.queryGraph(ctx, `
    SELECT ?n WHERE {
      VALUES ?n { ${values} }
      ?n thought:hasStatus thought:established .
    } LIMIT 1
  `);
  return r.results.length > 0;
}

/** Payload kinds that `dispatchApply` actually knows how to apply. Keep in
 *  sync with the `switch` in dispatchApply — the `source` / `saved-query`
 *  kinds are defined on the type but not yet wired to a dispatcher. */
const WIRED_PAYLOAD_KINDS = new Set<ProposalPayload['kind']>(['graph-triples', 'note', 'excerpt', 'note-refactor', 'note-delete', 'note-rewrite', 'source-meta']);

/**
 * Reject a bundle containing a payload kind that has no apply dispatcher (#665).
 * Without this, an un-wired kind (`source` / `saved-query`) could be filed as a
 * pending proposal and only blow up — with NotImplementedError — when the user
 * clicks Approve. Fail fast at creation instead, so a skill emitting an
 * unsupported kind surfaces the bug immediately rather than at the user's
 * approve click.
 */
function assertWiredPayloads(payloads: ProposalPayload[]): void {
  for (const p of payloads) {
    if (!WIRED_PAYLOAD_KINDS.has(p.kind)) {
      throw new Error(
        `proposeWrite: payload kind "${p.kind}" has no apply dispatcher yet — ` +
        `filing this proposal would fail at approval time. ` +
        `Wired kinds: ${[...WIRED_PAYLOAD_KINDS].join(', ')}.`,
      );
    }
  }
}

/**
 * Submit a proposed bundle. Based on the operation's approval tier:
 * - requires_approval: persists a pending Proposal, returns it.
 * - notify_only: applies the bundle immediately, persists an approved
 *   Proposal for audit.
 * - autonomous: applies the bundle immediately, no proposal record.
 */
export async function proposeWrite(ctx: ProjectContext, write: ProposedWrite): Promise<Proposal | null> {
  assertWiredPayloads(write.payloads);
  let tier = getApprovalTier(write.operationType);
  const now = new Date().toISOString();
  const expiryDate = new Date(Date.now() + (write.expiryDays ?? 7) * 86400000).toISOString();

  // Established-node escalation (#656). Computed before the tier dispatch so it
  // can pull an autonomous/notify_only write up to requires_approval when it
  // touches a human-vetted node — the Trust Principle invariant CLAUDE.md
  // documents. Collected here (not after the autonomous return) so the check
  // covers autonomous ops too.
  const affectsNodeUris = collectAffectsNodes(ctx, write.payloads);
  if (tier !== 'requires_approval' && await anyNodeEstablished(ctx, affectsNodeUris)) {
    tier = 'requires_approval';
  }

  if (tier === 'autonomous') {
    await applyBundle(ctx, write.payloads);
    return null;
  }

  const uri = proposalUri();
  const proposal: Proposal = {
    uri,
    status: tier === 'notify_only' ? 'approved' : 'pending',
    operationType: write.operationType,
    payloads: write.payloads,
    note: write.note,
    affectsNodeUris,
    conversationUri: write.conversationUri,
    proposedBy: write.proposedBy,
    proposedAt: now,
    autoExpires: expiryDate,
  };

  await writeProposalToGraph(ctx, proposal);

  if (tier === 'notify_only') {
    await applyBundle(ctx, write.payloads);
  }

  return proposal;
}

/**
 * Approve a pending proposal: apply its bundle and update status.
 */
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

export async function approveProposal(ctx: ProjectContext, uri: string): Promise<ApproveResult> {
  const proposal = await getProposal(ctx, uri);
  if (!proposal || proposal.status !== 'pending') return { ok: false, filedPaths: [], rewrittenPaths: [] };

  if (proposal.payloads.length === 0) {
    // Don't quietly flip status to approved on an empty bundle — that's
    // the silent-no-op the user hit. Either the proposal was filed wrong,
    // or its payload JSON is broken. Either way the user deserves to see it.
    throw new Error(
      `Proposal ${uri} has no payloads to apply. Refusing to approve it as a no-op.`,
    );
  }

  console.log(
    `[approval] applying ${proposal.payloads.length} payload(s) for ${uri}: ` +
    proposal.payloads.map((p) => p.kind).join(', '),
  );

  const applied = await applyBundle(ctx, proposal.payloads);
  await updateProposalStatus(ctx, uri, 'approved');
  const filedPaths = applied
    .filter((a): a is AppliedRecord & { kind: 'note' } => a.kind === 'note')
    .map((a) => (a.rollbackData as { resolvedPath: string }).resolvedPath);
  const rewrittenPaths = applied
    .filter((a): a is AppliedRecord & { kind: 'note-rewrite' } => a.kind === 'note-rewrite')
    .map((a) => (a.rollbackData as { path: string }).path);
  return { ok: true, filedPaths, rewrittenPaths };
}

/**
 * Reject a pending proposal: update status without applying.
 */
export async function rejectProposal(ctx: ProjectContext, uri: string): Promise<boolean> {
  const proposal = await getProposal(ctx, uri);
  if (!proposal || proposal.status !== 'pending') return false;

  await updateProposalStatus(ctx, uri, 'rejected');
  return true;
}

/**
 * Expire proposals past their autoExpires date.
 */
export async function expireProposals(ctx: ProjectContext): Promise<number> {
  const results = await graph.queryGraph(ctx, `
    SELECT ?proposal ?expires WHERE {
      ?proposal a thought:Proposal .
      ?proposal thought:proposalStatus thought:pending .
      ?proposal thought:autoExpires ?expires .
    }
  `);

  const now = new Date();
  let count = 0;
  for (const row of results.results as Record<string, string>[]) {
    const expires = new Date(row.expires);
    if (expires <= now) {
      await updateProposalStatus(ctx, row.proposal, 'expired');
      count++;
    }
  }
  return count;
}

/**
 * List proposals, optionally filtered by status.
 */
export async function listProposals(ctx: ProjectContext, status?: string): Promise<Proposal[]> {
  const statusFilter = status
    ? `?proposal thought:proposalStatus thought:${status} .`
    : '';

  const results = await graph.queryGraph(ctx, `
    SELECT ?proposal ?status ?operationType ?note ?proposedBy ?proposedAt ?autoExpires ?payloadJson
           (GROUP_CONCAT(DISTINCT ?affectsNode; separator="\\u001f") AS ?affectsNodes)
           ?conversation WHERE {
      ?proposal a thought:Proposal .
      ?proposal thought:proposalStatus ?statusNode .
      BIND(REPLACE(STR(?statusNode), "${THOUGHT}", "") AS ?status)
      ?proposal thought:operationType ?operationType .
      ?proposal thought:proposalNote ?note .
      ?proposal thought:proposedBy ?proposedBy .
      ?proposal thought:proposedAt ?proposedAt .
      ?proposal thought:autoExpires ?autoExpires .
      ?proposal thought:payloadJson ?payloadJson .
      ${statusFilter}
      OPTIONAL { ?proposal thought:affectsNode ?affectsNode }
      OPTIONAL { ?proposal thought:conversationRef ?conversation }
    }
    GROUP BY ?proposal ?status ?operationType ?note ?proposedBy ?proposedAt ?autoExpires ?payloadJson ?conversation
    ORDER BY DESC(?proposedAt)
  `);

  return (results.results as Record<string, string>[]).map(row => proposalFromRow(row));
}

/**
 * Get a single proposal by URI.
 */
export async function getProposal(ctx: ProjectContext, uri: string): Promise<Proposal | null> {
  const results = await graph.queryGraph(ctx, `
    SELECT ?status ?operationType ?note ?proposedBy ?proposedAt ?autoExpires ?payloadJson ?affectsNode ?conversation WHERE {
      <${uri}> a thought:Proposal .
      <${uri}> thought:proposalStatus ?statusNode .
      BIND(REPLACE(STR(?statusNode), "${THOUGHT}", "") AS ?status)
      <${uri}> thought:operationType ?operationType .
      <${uri}> thought:proposalNote ?note .
      <${uri}> thought:proposedBy ?proposedBy .
      <${uri}> thought:proposedAt ?proposedAt .
      <${uri}> thought:autoExpires ?autoExpires .
      <${uri}> thought:payloadJson ?payloadJson .
      OPTIONAL { <${uri}> thought:affectsNode ?affectsNode }
      OPTIONAL { <${uri}> thought:conversationRef ?conversation }
    }
  `);

  const rows = results.results as Record<string, string>[];
  if (rows.length === 0) return null;
  const firstRow = rows[0];
  const affectsNodeUris = Array.from(
    new Set(rows.map(row => row.affectsNode).filter((u): u is string => Boolean(u))),
  );
  return {
    uri,
    status: firstRow.status as Proposal['status'],
    operationType: firstRow.operationType,
    payloads: parsePayloads(firstRow.payloadJson),
    note: firstRow.note,
    affectsNodeUris,
    conversationUri: firstRow.conversation,
    proposedBy: firstRow.proposedBy,
    proposedAt: firstRow.proposedAt,
    autoExpires: firstRow.autoExpires,
  };
}

function proposalFromRow(row: Record<string, string>): Proposal {
  return {
    uri: row.proposal,
    status: row.status as Proposal['status'],
    operationType: row.operationType,
    payloads: parsePayloads(row.payloadJson),
    note: row.note,
    affectsNodeUris: splitAffectsNodes(row.affectsNodes),
    conversationUri: row.conversation,
    proposedBy: row.proposedBy,
    proposedAt: row.proposedAt,
    autoExpires: row.autoExpires,
  };
}

function parsePayloads(json: string | undefined): ProposalPayload[] {
  if (!json) {
    // This can be a real proposal-with-zero-payloads or a graph that was
    // written before #418. Returning [] silently was masking the bug Dave
    // hit ("approve succeeded but no notes appeared") — log loudly so the
    // dev console shows it next time.
    console.warn('[approval] proposal has no payloadJson — returning empty payload list');
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    // Throwing here is correct: a proposal whose payload JSON is corrupt
    // should NOT silently approve as a no-op — the user clicked Approve
    // expecting something to land. Surface the error to the panel.
    throw new Error(
      `Proposal payload JSON failed to parse (${e instanceof Error ? e.message : String(e)}). ` +
      `Length: ${json.length}; head: ${JSON.stringify(json.slice(0, 120))}`,
      { cause: e },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Proposal payload JSON is not an array (got ${typeof parsed}).`);
  }
  return parsed as ProposalPayload[];
}

/** Split the GROUP_CONCAT result for affectsNode URIs back into a list.
 *  Separator matches the SPARQL GROUP_CONCAT call above (). */
function splitAffectsNodes(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(String.fromCharCode(0x1f)).filter(Boolean);
}

// ── Apply path ─────────────────────────────────────────────────────────────

/**
 * Per-payload undo state. `dispatch` populates this as each payload
 * lands; on failure of a later payload we walk it in reverse.
 */
interface AppliedRecord {
  kind: ProposalPayload['kind'];
  /** Resolved data the rollback needs (note path, source id, query
   *  filePath, etc). */
  rollbackData: unknown;
}

async function applyBundle(ctx: ProjectContext, payloads: ProposalPayload[]): Promise<AppliedRecord[]> {
  // Apply file-system payloads first, triples last. Lets a triples
  // parse failure roll back FS effects without needing an rdflib
  // snapshot.
  const ordered = [
    ...payloads.filter((p) => p.kind !== 'graph-triples'),
    ...payloads.filter((p) => p.kind === 'graph-triples'),
  ];

  // Everything a bundle applies is a *trusted* mutation. Wrapping the whole
  // apply (not just applyTurtle) means the graph writes inside dispatchApply —
  // indexNote / indexSource / indexExcerpt — are exempt from the trust guard
  // even when the caller is in LLM context (e.g. an approve-handler wrapped in
  // enterLLMContext so the guard is armed on its non-approval writes, #944).
  graph.enterTrustedContext();
  const applied: AppliedRecord[] = [];
  try {
    for (const p of ordered) {
      const rollbackData = await dispatchApply(ctx, p);
      applied.push({ kind: p.kind, rollbackData });
    }
    return applied;
  } catch (err) {
    // Reverse-order rollback. Best-effort — log but don't mask the
    // original error.
    for (const a of [...applied].reverse()) {
      try { await dispatchRollback(ctx, a); }
      catch (rollbackErr) { console.warn(`[approval] rollback of ${a.kind} failed:`, rollbackErr); }
    }
    throw err;
  } finally {
    graph.exitTrustedContext();
  }
}

/** Narrow ProposalPayload to a single discriminant so the applyXxx helpers
 *  receive the exact payload shape the dispatcher matched. */
type PayloadOf<K extends ProposalPayload['kind']> = Extract<ProposalPayload, { kind: K }>;

/**
 * Route a payload to its apply helper. The switch stays a switch (not a map):
 * each case's undo/rollback contract genuinely diverges, and returning the
 * per-kind rollbackData shape is what dispatchRollback consumes. The case
 * bodies live in named applyXxx helpers so this reads as a routing table.
 */
async function dispatchApply(ctx: ProjectContext, p: ProposalPayload): Promise<unknown> {
  switch (p.kind) {
    case 'graph-triples':
      await applyTurtle(ctx, p.turtle);
      return null;
    case 'note':
      return applyNote(ctx, p);
    case 'excerpt':
      return applyExcerpt(ctx, p);
    case 'note-refactor':
      return applyNoteRefactor(ctx, p);
    case 'note-delete':
      return applyNoteDelete(ctx, p);
    case 'note-rewrite':
      return applyNoteRewrite(ctx, p);
    case 'source-meta':
      return applySourceMeta(ctx, p);
    case 'source':
    case 'saved-query':
      throw new Error(
        `Approval payload kind "${p.kind}" not yet wired (#418 ships graph-triples + note; later kinds land as needed).`,
      );
  }
}

async function applyNote(ctx: ProjectContext, p: PayloadOf<'note'>): Promise<{ resolvedPath: string }> {
  const finalPath = await resolveCollidingPath(ctx.rootPath, p.relativePath);
  await notebaseFs.createFile(ctx.rootPath, finalPath);
  await notebaseFs.writeFile(ctx.rootPath, finalPath, p.content);
  await graph.indexNote(ctx, finalPath, p.content);
  if (p.backlink) {
    const noteUri = graph.noteUriFor(ctx, finalPath);
    if (noteUri) {
      await applyTurtle(
        ctx,
        `<${p.backlink.fromUri}> <${p.backlink.predicate}> <${noteUri}> .`,
      );
    }
  }
  return { resolvedPath: finalPath };
}

async function applyExcerpt(ctx: ProjectContext, p: PayloadOf<'excerpt'>): Promise<{ excerptPath: string }> {
  // #104: file a thought:Excerpt node so claim-extraction can anchor its
  // evidence. Mirrors the `note` case — write the .ttl then index directly
  // (rather than waiting on the chokidar watcher) so the graph reflects it
  // immediately for the claim notes' `[[quote::id]]` edges in the same bundle.
  const relativePath = `.minerva/excerpts/${p.excerptId}.ttl`;
  await notebaseFs.createFile(ctx.rootPath, relativePath);
  await notebaseFs.writeFile(ctx.rootPath, relativePath, p.excerptTtl);
  graph.indexExcerpt(ctx, p.excerptId, p.excerptTtl);
  return { excerptPath: relativePath };
}

async function applyNoteRefactor(ctx: ProjectContext, p: PayloadOf<'note-refactor'>): Promise<unknown> {
  // Capture pre-images of every file the refactor will touch BEFORE applying,
  // so rollback can restore them verbatim (a reverse rename can mis-rewrite a
  // note that already linked to the destination). planRename also runs the
  // guardrails (collision / no-op / unsafe / folder) — it throws on violation.
  const plan = await planRename(ctx.rootPath, p.fromPath, p.toPath);
  const preImages: Record<string, string> = {
    [p.fromPath]: await notebaseFs.readFile(ctx.rootPath, p.fromPath),
  };
  for (const a of plan.affectedNotes) {
    if (!(a.path in preImages)) preImages[a.path] = a.before;
  }

  const { transitions, rewrittenPaths } = await renameWithLinkRewrites(ctx.rootPath, p.fromPath, p.toPath, {
    markPathHandled,
    reindexHook: (relPath, content) => {
      if (relPath.endsWith('.md')) {
        search.indexNote(ctx, relPath, content);
        void vectors.indexNote(ctx, relPath, content);
      }
    },
    removeHook: (relPath) => {
      search.removeNote(ctx, relPath);
      void vectors.removeNote(ctx, relPath);
    },
  });
  return { fromPath: p.fromPath, toPath: p.toPath, preImages, transitions, rewrittenPaths };
}

async function applyNoteDelete(ctx: ProjectContext, p: PayloadOf<'note-delete'>): Promise<{ path: string; content: string }> {
  // Capture the file content before deleting so rollback can recreate it
  // verbatim. markPathHandled suppresses the watcher's re-index of the
  // unlink (it still broadcasts NOTEBASE_FILE_DELETED so the renderer
  // closes the tab + refreshes the tree). De-index across graph/search/
  // vectors mirrors the manual delete path.
  const content = await notebaseFs.readFile(ctx.rootPath, p.path);
  markPathHandled(p.path);
  await notebaseFs.deleteFile(ctx.rootPath, p.path);
  graph.removeNote(ctx, p.path);
  search.removeNote(ctx, p.path);
  void vectors.removeNote(ctx, p.path);
  return { path: p.path, content };
}

async function applyNoteRewrite(ctx: ProjectContext, p: PayloadOf<'note-rewrite'>): Promise<{ path: string; before: string }> {
  // Overwrite an existing note in place (#936). Guardrails: must be a .md
  // note that already exists — readFile throws ENOENT for a missing file,
  // which propagates and rolls the bundle back (a rewrite of a nonexistent
  // note is a bug in the caller, not a note to create). Capture the prior
  // content as a pre-image for rollback, then write + reindex inline.
  // markPathHandled dedups the watcher's re-index of our own write; the
  // renderer refresh is driven by the IPC layer via NOTEBASE_REWRITTEN
  // (which consumes ApproveResult.rewrittenPaths), mirroring how the
  // bypassing auto-tag/set_properties paths broadcast today.
  if (!p.path.endsWith('.md')) {
    throw new Error(`note-rewrite: refusing to rewrite non-markdown path "${p.path}".`);
  }
  const before = await notebaseFs.readFile(ctx.rootPath, p.path);
  markPathHandled(p.path);
  await notebaseFs.writeFile(ctx.rootPath, p.path, p.content);
  await graph.indexNote(ctx, p.path, p.content);
  search.indexNote(ctx, p.path, p.content);
  void vectors.indexNote(ctx, p.path, p.content);
  return { path: p.path, before };
}

async function applySourceMeta(ctx: ProjectContext, p: PayloadOf<'source-meta'>): Promise<{ sourceId: string; before: string }> {
  // Upsert the proposed predicates into the source's meta.ttl (#943).
  // Capture the whole meta.ttl as a pre-image so rollback restores it
  // verbatim. setSourceProperties writes + reindexes; the .minerva/sources
  // watcher notifies the renderer (same path the direct write used).
  const before = await readMeta(sourceMetaPath(ctx.rootPath, p.sourceId));
  await setSourceProperties(ctx.rootPath, p.sourceId, p.updates);
  return { sourceId: p.sourceId, before };
}

async function dispatchRollback(ctx: ProjectContext, a: AppliedRecord): Promise<void> {
  switch (a.kind) {
    case 'graph-triples':
      // Triples ran last by construction — nothing after them to
      // undo. Triples rollback would require an rdflib snapshot;
      // skipped per #418's "triples-last" convention.
      return;
    case 'note': {
      const data = a.rollbackData as { resolvedPath: string };
      try { await notebaseFs.deleteFile(ctx.rootPath, data.resolvedPath); }
      catch { /* file may already be gone */ }
      graph.removeNote(ctx, data.resolvedPath);
      return;
    }
    case 'excerpt': {
      const data = a.rollbackData as { excerptPath: string };
      try { await notebaseFs.deleteFile(ctx.rootPath, data.excerptPath); }
      catch { /* file may already be gone */ }
      // No graph.removeExcerpt today; rollback is best-effort and a reindex
      // reconciles any drift (same posture as the triples-last convention).
      return;
    }
    case 'note-refactor': {
      const data = a.rollbackData as { fromPath: string; toPath: string; preImages: Record<string, string> };
      // Move the note back: drop the destination, then restore every captured
      // pre-image (the moved file at its original path + each rewritten note's
      // verbatim original content). Reindex each across graph/search/vectors.
      markPathHandled(data.toPath);
      try { await notebaseFs.deleteFile(ctx.rootPath, data.toPath); } catch { /* already gone */ }
      graph.removeNote(ctx, data.toPath);
      search.removeNote(ctx, data.toPath);
      void vectors.removeNote(ctx, data.toPath);
      for (const [relPath, content] of Object.entries(data.preImages)) {
        try {
          markPathHandled(relPath);
          await notebaseFs.writeFile(ctx.rootPath, relPath, content);
          await graph.indexNote(ctx, relPath, content);
          search.indexNote(ctx, relPath, content);
          void vectors.indexNote(ctx, relPath, content);
        } catch (err) {
          console.warn(`[approval] note-refactor rollback restore failed for ${relPath}:`, err);
        }
      }
      return;
    }
    case 'note-delete': {
      // Recreate the deleted note from its captured pre-image and reindex.
      const data = a.rollbackData as { path: string; content: string };
      try {
        markPathHandled(data.path);
        await notebaseFs.createFile(ctx.rootPath, data.path);
        await notebaseFs.writeFile(ctx.rootPath, data.path, data.content);
        await graph.indexNote(ctx, data.path, data.content);
        search.indexNote(ctx, data.path, data.content);
        void vectors.indexNote(ctx, data.path, data.content);
      } catch (err) {
        console.warn(`[approval] note-delete rollback restore failed for ${data.path}:`, err);
      }
      return;
    }
    case 'note-rewrite': {
      // Restore the note's captured pre-image and reindex (#936). Same posture
      // as note-delete rollback: best-effort, markPathHandled dedups the
      // watcher, reindex across graph/search/vectors.
      const data = a.rollbackData as { path: string; before: string };
      try {
        markPathHandled(data.path);
        await notebaseFs.writeFile(ctx.rootPath, data.path, data.before);
        await graph.indexNote(ctx, data.path, data.before);
        search.indexNote(ctx, data.path, data.before);
        void vectors.indexNote(ctx, data.path, data.before);
      } catch (err) {
        console.warn(`[approval] note-rewrite rollback restore failed for ${data.path}:`, err);
      }
      return;
    }
    case 'source-meta': {
      // Restore the source's captured pre-image meta.ttl and reindex (#943).
      const data = a.rollbackData as { sourceId: string; before: string };
      try {
        await restoreSourceMeta(ctx.rootPath, data.sourceId, data.before);
      } catch (err) {
        console.warn(`[approval] source-meta rollback restore failed for ${data.sourceId}:`, err);
      }
      return;
    }
    case 'source':
    case 'saved-query':
      // Never reached today — apply throws before recording an
      // applied entry for these kinds.
      return;
  }
}

/** Apply-time path dedup. Mirrors `resolveDropName` in drop-import. */
async function resolveCollidingPath(rootPath: string, relativePath: string): Promise<string> {
  const path = await import('node:path');
  const fs = await import('node:fs/promises');
  const dir = path.dirname(relativePath);
  const ext = path.extname(relativePath);
  const stem = path.basename(relativePath, ext);
  let candidate = relativePath;
  let suffix = 2;
  while (true) {
    try {
      await fs.access(path.join(rootPath, candidate));
      // exists → try next
      candidate = dir === '.'
        ? `${stem}-${suffix}${ext}`
        : `${dir}/${stem}-${suffix}${ext}`;
      suffix++;
      if (suffix > 99) throw new Error(`resolveCollidingPath: 99 collisions on ${relativePath}`);
    } catch (err) {
      // ENOENT — slot is free
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
      throw err;
    }
  }
}

// ── Internal Helpers ───────────────────────────────────────────────────────

async function writeProposalToGraph(ctx: ProjectContext, p: Proposal): Promise<void> {
  const affectsNodeTriples = p.affectsNodeUris
    .map(u => `; thought:affectsNode <${u}>`)
    .join('\n      ');
  // Payloads are stored as JSON in a single literal so the proposal
  // is self-contained; restoring requires no additional triple
  // tracking. Larger payloads (note content, source bytes) go inline
  // — fine for typical Research-tool output, would need re-thinking
  // if proposal sizes blow up.
  const payloadJson = serializePayloadsForStorage(p.payloads);
  const turtle = `
    <${p.uri}> a thought:Proposal ;
      thought:proposalStatus thought:${p.status} ;
      thought:operationType "${escapeTurtleLiteral(p.operationType)}" ;
      thought:proposalNote "${escapeTurtleLiteral(p.note)}" ;
      thought:proposedBy "${escapeTurtleLiteral(p.proposedBy)}" ;
      thought:proposedAt "${p.proposedAt}"^^xsd:dateTime ;
      thought:autoExpires "${p.autoExpires}"^^xsd:dateTime ;
      thought:payloadJson "${escapeTurtleLiteral(payloadJson)}"
      ${affectsNodeTriples}
      ${p.conversationUri ? `; thought:conversationRef <${p.conversationUri}>` : ''} .
  `;
  await applyTurtle(ctx, turtle);
}

/** JSON-serialisable form. Drops Uint8Array bytes from `source`
 *  payloads — restoring those needs a different store (#418's MVP
 *  doesn't wire `source`, so this is a placeholder). */
function serializePayloadsForStorage(payloads: ProposalPayload[]): string {
  return JSON.stringify(payloads.map((p) => {
    if (p.kind === 'source' && p.original) {
      return { ...p, original: { ...p.original, bytes: '<elided>' } };
    }
    return p;
  }));
}

async function updateProposalStatus(ctx: ProjectContext, uri: string, newStatus: string): Promise<void> {
  // Drop any prior thought:proposalStatus triples on this proposal
  // before adding the new one — otherwise the proposal accumulates
  // {pending, approved, ...} markers and history queries return all
  // historical states (#332).
  graph.enterTrustedContext();
  try {
    graph.removeMatchingTriples(ctx, uri, `${THOUGHT}proposalStatus`);
  } finally {
    graph.exitTrustedContext();
  }
  await applyTurtle(ctx, `<${uri}> thought:proposalStatus thought:${newStatus} .`);
}

async function applyTurtle(ctx: ProjectContext, turtle: string): Promise<void> {
  const cleaned = stripTurtleCodeFence(turtle);
  const prefixed = `
    @prefix thought: <${THOUGHT}> .
    @prefix minerva: <https://minerva.dev/ontology#> .
    @prefix dc: <http://purl.org/dc/terms/> .
    @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    @prefix prov: <http://www.w3.org/ns/prov#> .
    ${cleaned}
  `;
  // Pre-flight parse into a throwaway store. graph.parseIntoStore
  // swallows parse errors with a console.error (it's the right call
  // for normal indexing — one bad note shouldn't poison the rest),
  // but the approval engine MUST surface them so a malformed
  // proposal triggers rollback rather than silently no-oping.
  const probe = $rdf.graph();
  $rdf.parse(prefixed, probe, 'urn:x-minerva:approval-validate', 'text/turtle');

  // Approval-engine writes are the *only* in-LLM-context writes that
  // shouldn't trip the trust guard. Everything else flowing through
  // parseIntoStore from an LLM call site is a bug we want to know about.
  graph.enterTrustedContext();
  try {
    graph.parseIntoStore(ctx, prefixed);
  } finally {
    graph.exitTrustedContext();
  }
  await graph.persistGraph(ctx);
}

/**
 * LLMs frequently emit Turtle wrapped in a markdown code fence —
 * ```turtle\n<turtle>\n``` — even when the prompt says "no code fence."
 * rdflib refuses to parse the fence as Turtle. Strip a single leading
 * ```<lang>\n and a single trailing \n``` before parsing. Any internal
 * backticks (e.g. inside string literals) are left alone.
 *
 * Returns the input unchanged when no fence is detected.
 */
export function stripTurtleCodeFence(turtle: string): string {
  // Match opening fence at first non-whitespace position; capture body up to
  // the matching closing fence at end of string (allowing trailing whitespace).
  const m = /^\s*```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(turtle);
  return m ? m[1] : turtle;
}
