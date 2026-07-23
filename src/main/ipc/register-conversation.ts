import { randomUUID } from 'node:crypto';
import { Channels } from '../../shared/channels';
import * as notebaseFs from '../notebase/fs';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { writeAndReindex } from '../notebase/write-pipeline';
import { ingestUrl } from '../sources/ingest';
import { ingestIdentifier } from '../sources/ingest-identifier';
import { privilegedFetch } from '../privileged-sites';
import { ttlString } from '../sources/source-meta-write';
import { fileSourceProperties } from '../llm/source-properties';
import { runCell as runComputeCell } from '../compute/registry';
import { buildExcerptTtl } from '../sources/create-excerpt';
import { slugify } from '../../shared/slug';
import { applyPropertyUpdates } from '../llm/set-properties';
import * as approval from '../llm/approval';
import type { Proposal } from '../llm/approval';
import { orderRefactors } from '../notebase/reorg';
import * as conversation from '../llm/conversation';
import { currentDateContext } from '../llm/date-context';
import { readThoughtbaseDoc, thoughtbaseDocPromptBlock } from '../llm/thoughtbase-doc';
import type { ContextBundle, ConversationMessage } from '../../shared/types';
import {
  formatComputeResultAsContext,
  recordComputeProposalRun,
  buildComputeProposalNoteBlock,
} from './register-compute';
import { rootPathFromEvent, winFromEvent, withRootPath, withRootPathOr, withRootPathWin, reindexFile, persistIndexes, hooks } from './helpers';
import { handle } from './typed-ipc';

const DEFAULT_CONVERSATION_SYSTEM_PROMPT = [
  'You are an assistant embedded in Minerva, a markdown-based thinking tool.',
  'The user is working inside a thoughtbase: a collection of interlinked notes backed by an RDF knowledge graph.',
  '',
  'You have read tools, web tools, and two write tools (propose_notes, propose_sources). Prefer the thoughtbase tools for anything inside the user\'s notes; use the web tools for facts, events, documentation, or sources outside the thoughtbase.',
  '',
  'Thoughtbase read tools:',
  '- search_notes: full-text search across the thoughtbase.',
  '- read_note: read a specific note by its relative path.',
  '- query_graph: run a SPARQL query against the knowledge graph (minerva/thought prefixes are auto-injected).',
  '- describe_graph_schema: fetch the full ontology TTL. Call this before writing a non-trivial SPARQL query if you are unsure about class or predicate names.',
  '- search_help: semantic search over Minerva\'s own user-facing documentation — not the thoughtbase, the app itself. Use this for "how do I…" / "what does X do in Minerva" questions instead of answering from training data, which has never seen this specific app and can be confidently wrong.',
  '',
  'Thoughtbase write tools:',
  '- propose_notes: file one or more notes for the user to review. The user sees an inline draft card with Approve/Discard. **You MUST call this tool — do NOT just describe the notes in chat and ask the user to file them, and do NOT tell them you can\'t create notes.** If you have just outlined a structure (a learning journey, a topic breakdown, a per-section explanation, a multi-claim summary), and the user wants it filed, call propose_notes with the whole bundle in one call (parent + children). The trust principle is preserved: nothing lands until the user clicks Approve. Only call propose_notes when you have concrete note bodies ready — never with an empty payload list, and never just to offer to make notes; if there is nothing to file yet, reply in plain text.',
  '- propose_sources: file one or more sources (papers, articles, web pages) into the user\'s Sources library. The user sees an inline draft card with Approve/Discard; on Approve, Minerva runs its full ingest pipeline (Crossref / arXiv / PubMed for identifiers; Readability for URLs) to fetch metadata and archive the source. **Prefer identifiers (DOI / arXiv id / PubMed id) over URLs** — the structured metadata is richer. Duplicates are skipped automatically. Use this when you have referenced a specific external work, when the user asks to add a citation, or when web_search surfaced sources that materially advance the conversation.',
  '',
  'Web tools:',
  '- web_search: search the web for current information, news, documentation, or external references.',
  '- web_fetch: fetch the contents of a specific URL — use this after web_search to read a promising result in full, or when the user gives you a URL directly.',
  '',
  'Minerva-specific markdown features (use these in note bodies whenever they materially help — and in inline reply examples if the user is asking how to use the feature):',
  '- ```python (also ```py, ```python3) — runnable Python cell. The user clicks the ▶ gutter icon (or Cmd/Ctrl+Shift+Enter) to execute; results land in a sibling ```output``` block that the editor manages. A persistent per-note kernel preserves variables across cells in the same note. The project root is on `sys.path`, so any `.py` file in the notebase is importable — `helpers.py` at the root → `import helpers`; `python/utils.py` → `from python import utils`. Reach for `propose_notes` with a `.py` payload when reusable logic emerges (helper functions, shared loaders, plotting wrappers). Heads-up: the kernel caches imported modules, so after editing a `.py` helper the user needs to restart the kernel for changes to land in already-imported cells (Compute menu → Restart Python Kernel).',
  '- ```sparql — runnable SPARQL query against the user\'s knowledge graph. Standard prefixes (minerva, thought, dc, rdf, rdfs, xsd, csvw, prov) are auto-injected, so write only the SELECT/ASK/CONSTRUCT body. Same run mechanism.',
  '- ```sql — runnable SQL query (DuckDB) against tables. Markdown tables in the user\'s notes become queryable via CSVW; column headers become the schema. Same run mechanism.',
  '- ```mermaid — rendered inline as an SVG diagram in preview (flowcharts, sequence diagrams, ER diagrams, state diagrams, etc.). Use for structural overviews where a picture beats prose.',
  '- ```turtle — Turtle-RDF that is parsed into the note\'s named graph at save time. Use sparingly, and only for genuinely structured facts the user will want to query later (e.g. a `thought:Claim` with `thought:supports`/`thought:rebuts` links). Do NOT use it as a dumping ground for arbitrary metadata.',
  'Do NOT pre-fill a ```output``` block — leave outputs for the user to generate by running the cell. Reach for these features when they earn their keep; a plain prose answer is often better.',
  '',
  'Usage guidance:',
  '- For questions about the user\'s notes or ideas they\'ve captured, use search_notes and read_note.',
  '- For structural questions (what links to what, which notes share a tag, which claims cite a source), use query_graph; fall back to describe_graph_schema if a query fails or you are guessing at predicates.',
  '- For current events, external facts, recent research, or things outside the thoughtbase, use web_search.',
  '- For "how do I…" / "what does X do" / "where do I find…" questions about Minerva itself, call search_help before answering — do not rely on prior knowledge of similar apps, since you have never actually seen this one. If search_help returns a WEAK MATCH (or nothing usable), say plainly that the docs don\'t seem to cover it and offer the closest section you found, rather than falling back to a confident guess from general knowledge.',
  '- This applies mid-task, not just when the user asks directly: before asserting or relying on a specific Minerva capability you are not fully certain of (an exact markdown syntax, a tool\'s precise behavior, a settings option, a menu location) while drafting a note, proposing an action, or explaining a workflow, call search_help to verify first rather than presenting an unconfirmed guess as fact.',
  '- It\'s often useful to combine tools: search_notes to see what the user already has, then web_search to fill in what they don\'t. Cite your web sources.',
  '- When the user agrees to file something ("yes, file it", "file these as notes", "save this", "create the notes"), CALL propose_notes immediately — do not describe what you would file, do not ask for further confirmation. The Approve/Discard card IS the user\'s confirmation step.',
  '- When the user agrees to add sources ("add that paper", "save this source", "ingest this", "add the citation"), CALL propose_sources immediately with the relevant identifiers/URLs. The Approve/Discard card IS the user\'s confirmation step.',
  '',
  'When you call propose_notes or propose_sources, do NOT also paste the same content / URL list inline in your reply. The inline draft card is the deliverable; repeating it is duplicate noise.',
  '',
  'Answer in GitHub-flavored markdown. When you reference a note, cite its relative path so the user can open it.',
].join('\n');

async function buildConversationSystemPrompt(
  userSystem: string | undefined,
  contextBundle: ContextBundle,
  currentNotePath?: string,
  rootPath?: string | null,
): Promise<string> {
  const parts = [DEFAULT_CONVERSATION_SYSTEM_PROMPT];
  // The thoughtbase's own conventions doc (thoughtbase.md), when present, sits
  // right after the base instructions as authoritative project context —
  // foundational, before the per-turn/session context below.
  const thoughtbaseBlock = thoughtbaseDocPromptBlock(rootPath ? await readThoughtbaseDoc(rootPath) : null);
  if (thoughtbaseBlock) {
    parts.push('', thoughtbaseBlock);
  }
  // Dynamic per-turn context follows the static prompt. Within one session
  // (same day, same open note) it's stable, so the cached system block still
  // hits across turns; it only re-caches when the date or open note changes.
  parts.push('', currentDateContext());
  if (contextBundle.notePath) {
    parts.push('', `The user started this conversation from the note: ${contextBundle.notePath}`);
  }
  if (currentNotePath && currentNotePath !== contextBundle.notePath) {
    // Live context — the note the user is currently looking at, which may
    // differ from the conversation's origin. Resolves "this note" / "the
    // current note" in the user's prompts against what they're actually
    // viewing.
    parts.push('', `The note currently open in the editor is: ${currentNotePath}`);
  } else if (currentNotePath && currentNotePath === contextBundle.notePath) {
    parts.push('', 'The user is still viewing the origin note.');
  }
  if (userSystem && userSystem.trim()) {
    parts.push('', userSystem.trim());
  }
  return parts.join('\n');
}

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

export function registerConversation(): void {
  // Proposals
  handle(Channels.PROPOSAL_LIST, withRootPathOr<[string?], Proposal[] | Promise<Proposal[]>>([], (rootPath, status?: string) =>
    approval.listProposals(projectContext(rootPath), status)));
  handle(Channels.PROPOSAL_DETAIL, withRootPathOr(null, (rootPath, uri: string) =>
    approval.getProposal(projectContext(rootPath), uri)));
  handle(Channels.PROPOSAL_APPROVE, withRootPathOr<[string], boolean | Promise<boolean>>(false, async (rootPath, uri: string) => {
    const result = await approval.approveProposal(projectContext(rootPath), uri);
    return result.ok;
  }));
  handle(Channels.PROPOSAL_REJECT, withRootPathOr<[string], boolean | Promise<boolean>>(false, (rootPath, uri: string) =>
    approval.rejectProposal(projectContext(rootPath), uri)));
  handle(Channels.PROPOSAL_EXPIRE, withRootPathOr<[], number | Promise<number>>(0, (rootPath) =>
    approval.expireProposals(projectContext(rootPath))));

  // Conversations
  handle(Channels.CONVERSATION_CREATE, (_e, contextBundle: ContextBundle, triggerNodeUri?: string, options?: { systemPrompt?: string; model?: string }) =>
    conversation.create(contextBundle, triggerNodeUri, options));
  handle(Channels.CONVERSATION_APPEND, (_e, id: string, role: ConversationMessage['role'], content: string) =>
    conversation.appendMessage(id, role, content));
  handle(Channels.CONVERSATION_ARCHIVE, (_e, id: string) => conversation.archive(id));
  handle(Channels.CONVERSATION_LOAD, (_e, id: string) => conversation.load(id));
  handle(Channels.CONVERSATION_LIST, () => conversation.listAll());
  handle(Channels.CONVERSATION_LIST_ACTIVE, () => conversation.listActive());
  handle(Channels.CONVERSATION_UI_STATE_LOAD, () => conversation.loadUIState());
  handle(
    Channels.CONVERSATION_UI_STATE_SAVE,
    (_e, state: import('../../shared/types').ConversationsUIState) => conversation.saveUIState(state),
  );

  // Conversation send + LLM streaming
  const convAbortControllers = new Map<number, AbortController>();
  // Pending ask_user prompts keyed by question id. The CONVERSATION_SEND
  // handler creates an entry when the agent calls ask_user, and the
  // CONVERSATION_ASK_USER_REPLY handler resolves (or rejects) it. Aborting
  // the send rejects every pending question for that window so the agent
  // loop unwinds cleanly instead of hanging on an answered-never promise.
  const pendingAskUser = new Map<string, { winId: number; resolve: (answer: string) => void; reject: (err: Error) => void }>();

  handle(Channels.CONVERSATION_ASK_USER_REPLY, (_e, questionId: string, answer: string) => {
    const pending = pendingAskUser.get(questionId);
    if (!pending) return;
    pendingAskUser.delete(questionId);
    pending.resolve(answer);
  });

  handle(Channels.CONVERSATION_SEND, async (e, convId: string, userMessage: string, systemPrompt?: string, currentNotePath?: string, extraTools?: import('../../shared/conversation-tools').ConversationToolKey[]) => {
    const win = winFromEvent(e);
    const rootPath = rootPathFromEvent(e);
    const controller = new AbortController();
    convAbortControllers.set(win.id, controller);
    // When this send is aborted, fail any in-flight ask_user prompts so
    // the agent's tool-call loop unwinds.
    controller.signal.addEventListener('abort', () => {
      for (const [qid, pending] of pendingAskUser) {
        if (pending.winId === win.id) {
          pendingAskUser.delete(qid);
          pending.reject(new Error('aborted'));
        }
      }
    });

    // Unconditional log so we can prove the current build is loaded —
    // if the user reports "no log messages" again, this is missing too.
    console.log(`[conv] SEND start: conv=${convId} userMsgLen=${userMessage.length}`);

    graph.enterLLMContext();
    try {
      const conv = await conversation.appendMessage(convId, 'user', userMessage);

      const { completeWithTools } = await import('../llm/index');
      const messages = conv.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const effectiveSystem = await buildConversationSystemPrompt(
        systemPrompt ?? conv.systemPrompt,
        conv.contextBundle,
        currentNotePath,
        rootPath,
      );

      if (!rootPath) {
        throw new Error('No thoughtbase is open — cannot send conversation message.');
      }

      // Forward a draft to this window's renderer. Every draft kind shares this
      // send — the divergent per-kind work is in the CONVERSATION_FILE_*_DRAFT
      // handlers below, not here (#980).
      const draftEmit =
        (channel: string) =>
        (draft: import('../../shared/conversation-draft-base').ConversationDraftBase) => {
          if (!win.isDestroyed()) {
            win.webContents.send(channel, draft);
          }
        };
      const streamCallbacks = {
        onChunk: (chunk: string) => {
          if (!win.isDestroyed()) {
            win.webContents.send(Channels.CONVERSATION_STREAM, chunk);
          }
        },
        onDraft: draftEmit(Channels.CONVERSATION_DRAFT),
        onSourceDraft: draftEmit(Channels.CONVERSATION_SOURCE_DRAFT),
        onPropertyDraft: draftEmit(Channels.CONVERSATION_PROPERTY_DRAFT),
        onSourcePropertyDraft: draftEmit(Channels.CONVERSATION_SOURCE_PROPERTY_DRAFT),
        onClaimsDraft: draftEmit(Channels.CONVERSATION_CLAIMS_DRAFT),
        onComputeDraft: draftEmit(Channels.CONVERSATION_COMPUTE_DRAFT),
        onRefactorDraft: draftEmit(Channels.CONVERSATION_REFACTOR_DRAFT),
        onReorgDraft: draftEmit(Channels.CONVERSATION_REORG_DRAFT),
        onDeleteDraft: draftEmit(Channels.CONVERSATION_DELETE_DRAFT),
        onNoteBodyDraft: draftEmit(Channels.CONVERSATION_NOTE_BODY_DRAFT),
        askUser: ({ question, choices }: { question: string; choices?: string[] }) => {
          const questionId = randomUUID();
          return new Promise<string>((resolve, reject) => {
            pendingAskUser.set(questionId, { winId: win.id, resolve, reject });
            if (!win.isDestroyed()) {
              win.webContents.send(Channels.CONVERSATION_ASK_USER, {
                questionId,
                conversationId: convId,
                question,
                choices,
              });
            } else {
              pendingAskUser.delete(questionId);
              reject(new Error('window destroyed'));
            }
          });
        },
        signal: controller.signal,
      };

      // Token the API's "container_id required" error to match against
      // its 400 message. Hoisted so the catch can string-match without
      // duplicating the phrase.
      const CONTAINER_REQUIRED_MARKER = 'container_id is required';
      // Strip assistant turns whose persisted text carries the
      // code_execution indicator markers we emit (`_🔍 Searching` /
      // `_🌐 Fetching` / `_⚙️ Running code`). Those messages are the
      // only ones whose presence in history can make the API demand a
      // container; once dropped, the API has nothing to "pend" on.
      // Lossy (the user loses the prior tool-result text in history),
      // but the alternative is a stuck conversation.
      const stripCodeExecutionTurns = (msgs: typeof messages) =>
        msgs.filter((m) => {
          if (m.role !== 'assistant' || typeof m.content !== 'string') return true;
          return !/_(?:🔍 Searching|🌐 Fetching|⚙️ Running code)/.test(m.content);
        });

      let result: Awaited<ReturnType<typeof completeWithTools>>;
      try {
        result = await completeWithTools({
          system: effectiveSystem,
          messages,
          toolContext: { rootPath, conversationId: convId },
          model: conv.model,
          effort: conv.effort,
          extraTools,
          // Re-echo any prior turn's code-execution sandbox id. Required
          // by the API whenever the persisted message history still
          // contains a `server_tool_use` block; without it the next
          // turn rejects with "container_id is required when there are
          // pending tool uses generated by code execution with tools."
          ...(conv.containerId ? { initialContainerId: conv.containerId } : {}),
          callbacks: streamCallbacks,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes(CONTAINER_REQUIRED_MARKER)) throw err;
        // The API rejected because the persisted container id is
        // missing or stale and history still references code_execution.
        // Two common causes: the conversation predates container
        // persistence, or the container expired server-side. Drop the
        // cached id, strip the offending assistant turns from history,
        // and retry once. If it still fails, the original error
        // surfaces.
        console.warn(
          `[conv] container_id 400 — recovering. conv=${convId} ` +
          `cachedContainer=${conv.containerId ?? 'none'} stripping code_execution turns`,
        );
        await conversation.setContainerId(convId, undefined, undefined);
        const recoveredMessages = stripCodeExecutionTurns(messages);
        result = await completeWithTools({
          system: effectiveSystem,
          messages: recoveredMessages,
          toolContext: { rootPath, conversationId: convId },
          model: conv.model,
          effort: conv.effort,
          extraTools,
          callbacks: streamCallbacks,
        });
      }

      const updated = await conversation.appendMessage(
        convId,
        'assistant',
        result.text,
        { citations: result.citations, usage: result.usage, usageModel: result.usageModel },
      );
      // Persist the (possibly updated) container id so the next turn
      // for this conversation can echo it. We write unconditionally
      // — even if the id is unchanged — because conversation.load /
      // appendMessage above don't preserve fields completeWithTools
      // can update mid-turn.
      if (result.containerId) {
        await conversation.setContainerId(
          convId,
          result.containerId,
          result.containerExpiresAt,
        );
      }
      return updated;
    } finally {
      convAbortControllers.delete(win.id);
      graph.exitLLMContext();
    }
  });

  handle(Channels.CONVERSATION_CANCEL, (e) => {
    const win = winFromEvent(e);
    const controller = convAbortControllers.get(win.id);
    if (controller) {
      controller.abort();
      convAbortControllers.delete(win.id);
    }
  });

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
        conversationUri: `https://minerva.dev/ontology/thought#conversation/${draft.conversationId}`,
        proposedBy: `llm:conversation:${draft.conversationId}`,
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
      const proposal = await approval.proposeWrite(ctx, {
        operationType: 'note_refactor',
        payloads: [{ kind: 'note-refactor', fromPath: draft.fromPath, toPath: draft.toPath }],
        note: draft.note,
        conversationUri: `https://minerva.dev/ontology/thought#conversation/${draft.conversationId}`,
        proposedBy: `llm:conversation:${draft.conversationId}`,
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
      const proposal = await approval.proposeWrite(ctx, {
        operationType: 'note_refactor',
        payloads: ordered.map((i) => ({ kind: 'note-refactor' as const, fromPath: i.fromPath, toPath: i.toPath })),
        note: draft.note,
        conversationUri: `https://minerva.dev/ontology/thought#conversation/${draft.conversationId}`,
        proposedBy: `llm:conversation:${draft.conversationId}`,
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
      if (!Array.isArray(selected) || selected.length === 0) {
        return { proposalUri: null, applied: false };
      }
      const ctx = projectContext(rootPath);
      const proposal = await approval.proposeWrite(ctx, {
        operationType: 'note_delete',
        payloads: selected.map((path) => ({ kind: 'note-delete' as const, path })),
        note: draft.note,
        conversationUri: `https://minerva.dev/ontology/thought#conversation/${draft.conversationId}`,
        proposedBy: `llm:conversation:${draft.conversationId}`,
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
    ): Promise<import('../../shared/conversation-note-body-drafts').FileNoteBodyDraftResult> => {
      if (!draft?.relativePath || typeof draft.afterContent !== 'string') {
        throw new Error(
          `FILE_NOTE_BODY_DRAFT: draft missing relativePath/afterContent (received ${JSON.stringify(draft).slice(0, 200)}). ` +
          `If this came from a Svelte 5 $state value, snapshot it before sending across IPC.`,
        );
      }
      const ctx = projectContext(rootPath);
      // Arm the trust guard (#944): LLM-originated, so a direct write here that
      // skips the approval engine trips checkLLMWriteGuard.
      return graph.withLLMContext(async () => {
        const proposal = await approval.proposeWrite(ctx, {
          operationType: 'note_rewrite',
          payloads: [{ kind: 'note-rewrite', path: draft.relativePath, content: draft.afterContent }],
          note: draft.note,
          conversationUri: `https://minerva.dev/ontology/thought#conversation/${draft.conversationId}`,
          proposedBy: `llm:conversation:${draft.conversationId}`,
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
          conversationUri: `https://minerva.dev/ontology/thought#conversation/${draft.conversationId}`,
          proposedBy: `llm:conversation:${draft.conversationId}`,
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
          win.webContents.send(Channels.SOURCES_CHANGED);
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
      const result = await runComputeCell(draft.language, codeToRun, { rootPath });
      // Append the result to the conversation log as a user-role
      // message so the LLM's next turn sees it as context. Format
      // for legibility — the model parses these like any other
      // user input.
      const contextMessage = formatComputeResultAsContext(draft, codeToRun, result);
      try {
        await conversation.appendMessage(draft.conversationId, 'user', contextMessage);
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
      await writeAndReindex(rootPath, dest, next, hooks);
      return { destinationPath: dest };
    }),
  );

  handle(Channels.CONVERSATION_SET_MODEL, async (_e, convId: string, model: string | undefined) => {
    return conversation.setModel(convId, model);
  });

  handle(
    Channels.CONVERSATION_SET_EFFORT,
    async (_e, convId: string, effort: import('../../shared/tools/effort').Effort | undefined) => {
      return conversation.setEffort(convId, effort);
    },
  );

  handle(Channels.CONVERSATION_COMPACT, (_e, convId: string) => compactConversation(convId));
}

/**
 * `/compact` (#824): client-side compaction. Summarizes the early history with
 * a model call and seeds a fresh conversation with the summary + the retained
 * recent turns. The pre-compaction original is archived (filed as a
 * thought:Source, recoverable from the archived list), never silently
 * destroyed. The summarization call's own token usage is recorded on the
 * summary message (#820). Decision/assembly logic is in `llm/compact.ts`.
 */
async function compactConversation(
  convId: string,
): Promise<import('../../shared/types').CompactResult> {
  const conv = await conversation.load(convId);
  if (!conv) throw new Error(`Conversation not found: ${convId}`);
  if (conv.status !== 'active') {
    return { compacted: false, reason: 'This conversation is archived and can\'t be compacted.' };
  }
  const { planCompaction, buildSummaryPrompt, buildSummaryMessage, COMPACT_SYSTEM_PROMPT } =
    await import('../llm/compact');
  const plan = planCompaction(conv.messages);
  if (!plan.ok) return { compacted: false, reason: plan.reason };

  let usage: import('../../shared/types').TurnUsage | undefined;
  let usageModel: string | undefined;
  const { complete } = await import('../llm/index');
  const summary = await complete(buildSummaryPrompt(plan.transcript), {
    system: COMPACT_SYSTEM_PROMPT,
    model: conv.model,
    onUsage: (u, m) => { usage = u; usageModel = m; },
  });
  const summaryMsg = buildSummaryMessage(
    plan.prefix.length,
    summary,
    usage,
    usageModel,
    new Date().toISOString(),
  );

  // Archive the original (files the full transcript as a thought:Source —
  // recoverable) before opening the compacted continuation.
  await conversation.archive(convId);
  const createOpts: { systemPrompt?: string; model?: string } = {};
  if (conv.systemPrompt) createOpts.systemPrompt = conv.systemPrompt;
  if (conv.model) createOpts.model = conv.model;
  const fresh = await conversation.create(
    conv.contextBundle,
    conv.triggerNodeUri,
    Object.keys(createOpts).length > 0 ? createOpts : undefined,
  );
  const updated = await conversation.replaceMessages(fresh.id, [summaryMsg, ...plan.recent]);
  return { compacted: true, conversation: updated };
}
