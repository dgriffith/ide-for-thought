/**
 * End-to-end of the conversation-drafts flow.
 *
 * Simulates what happens when:
 *   1. The LLM, mid-conversation, calls the `propose_notes` tool.
 *      → executeNotebaseTool emits a ConversationDraft via the
 *        onDraft callback. Nothing has touched disk yet.
 *   2. The user clicks Approve in the inline draft card.
 *      → the renderer hands the (full) draft back to main; the
 *        handler we exercise here files it through proposeWrite AND
 *        auto-approves so it lands as one Proposal in the panel.
 *
 * The Anthropic SDK is not in the loop — this is the boundary between
 * tool execution and the approval engine. The conversation IPC
 * `CONVERSATION_FILE_DRAFT` handler lives in `src/main/ipc.ts`; we
 * inline its body here so the test doesn't need a full Electron event
 * harness, but the body is intentionally minimal so it stays in sync.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { executeNotebaseTool, type ToolContext } from '../../../src/main/llm/tools';
import {
  proposeWrite,
  approveProposal,
  listProposals,
  resetPolicy,
} from '../../../src/main/llm/approval';
import { initGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import type { ConversationDraft } from '../../../src/shared/conversation-drafts';

const CONV_ID = 'conv-flow-test';

/**
 * Mirrors the body of the CONVERSATION_FILE_DRAFT handler in
 * src/main/ipc.ts. Keep these in sync.
 */
async function fileDraft(ctx: ProjectContext, draft: ConversationDraft) {
  const proposal = await proposeWrite(ctx, {
    operationType: 'component_creation',
    payloads: draft.payloads,
    note: draft.note,
    conversationUri: `https://minerva.dev/ontology/thought#conversation/${draft.conversationId}`,
    proposedBy: `llm:conversation:${draft.conversationId}`,
  });
  if (proposal) await approveProposal(ctx, proposal.uri);
  return proposal?.uri ?? null;
}

describe('conversation drafts: propose_notes → user-approve → file', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-drafts-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('end-to-end: tool emits draft → no proposal yet → user approves → notes land + proposal is approved', async () => {
    const drafts: ConversationDraft[] = [];
    const toolCtx: ToolContext = { rootPath: root, conversationId: CONV_ID };

    const out = await executeNotebaseTool(
      toolCtx,
      'propose_notes',
      {
        note: 'Learning Journey: Distributed Consensus (parent + 3 stops)',
        payloads: [
          { kind: 'note', relativePath: 'notes/distributed-consensus.md', content: '# Distributed Consensus\n\nIndex with [[stop-1]], [[stop-2]], [[stop-3]].\n' },
          { kind: 'note', relativePath: 'notes/distributed-consensus/stop-1.md', content: '# Stop 1: Replicated Logs\n' },
          { kind: 'note', relativePath: 'notes/distributed-consensus/stop-2.md', content: '# Stop 2: Quorum\n' },
          { kind: 'note', relativePath: 'notes/distributed-consensus/stop-3.md', content: '# Stop 3: Raft\n' },
        ],
      },
      { onDraft: (d) => drafts.push(d) },
    );

    // Server side: tool reported success, draft was queued, no Proposal filed.
    expect(out.isError).toBe(false);
    expect(drafts).toHaveLength(1);
    expect(await listProposals(ctx)).toHaveLength(0);
    for (const p of drafts[0].payloads) {
      expect(fs.existsSync(path.join(root, p.relativePath))).toBe(false);
    }

    // User clicks Approve in the inline card.
    const proposalUri = await fileDraft(ctx, drafts[0]);
    expect(proposalUri).not.toBeNull();

    // All four notes landed.
    for (const p of drafts[0].payloads) {
      const onDisk = await fsp.readFile(path.join(root, p.relativePath), 'utf-8');
      expect(onDisk).toBe(p.content);
    }

    // The Proposal is filed AND already approved (no second-gate review needed).
    const approved = await listProposals(ctx, 'approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].uri).toBe(proposalUri);
    expect(approved[0].proposedBy).toBe(`llm:conversation:${CONV_ID}`);
    expect(await listProposals(ctx, 'pending')).toHaveLength(0);
  });

  it('discarding a draft (user clicks Reject) is a pure UI action — no server state to clean', async () => {
    // Reject is implemented entirely in the renderer (it just removes
    // the card from the in-memory list). The server has nothing to do
    // because the original tool execution didn't persist anything.
    // This test just locks down the invariant.
    const drafts: ConversationDraft[] = [];
    const toolCtx: ToolContext = { rootPath: root, conversationId: CONV_ID };
    await executeNotebaseTool(
      toolCtx,
      'propose_notes',
      {
        note: 'something',
        payloads: [{ kind: 'note', relativePath: 'notes/x.md', content: '# x' }],
      },
      { onDraft: (d) => drafts.push(d) },
    );
    expect(drafts).toHaveLength(1);
    // No further action; nothing to undo.
    expect(await listProposals(ctx)).toHaveLength(0);
    expect(fs.existsSync(path.join(root, 'notes/x.md'))).toBe(false);
  });

  it('two drafts in one conversation are independent — approving one leaves the other pending', async () => {
    const drafts: ConversationDraft[] = [];
    const toolCtx: ToolContext = { rootPath: root, conversationId: CONV_ID };

    await executeNotebaseTool(toolCtx, 'propose_notes', {
      note: 'first',
      payloads: [{ kind: 'note', relativePath: 'notes/first.md', content: '# first' }],
    }, { onDraft: (d) => drafts.push(d) });

    await executeNotebaseTool(toolCtx, 'propose_notes', {
      note: 'second',
      payloads: [{ kind: 'note', relativePath: 'notes/second.md', content: '# second' }],
    }, { onDraft: (d) => drafts.push(d) });

    expect(drafts).toHaveLength(2);
    expect(drafts[0].draftId).not.toBe(drafts[1].draftId);

    // Approve only the first.
    await fileDraft(ctx, drafts[0]);
    expect(fs.existsSync(path.join(root, 'notes/first.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'notes/second.md'))).toBe(false);
    expect(await listProposals(ctx, 'approved')).toHaveLength(1);
  });

  it('apply-time path collision suffixes (-2) instead of overwriting an existing note', async () => {
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes/colliding.md'), 'pre-existing\n', 'utf-8');

    const drafts: ConversationDraft[] = [];
    const toolCtx: ToolContext = { rootPath: root, conversationId: CONV_ID };
    await executeNotebaseTool(toolCtx, 'propose_notes', {
      note: 'collision',
      payloads: [{ kind: 'note', relativePath: 'notes/colliding.md', content: 'NEW\n' }],
    }, { onDraft: (d) => drafts.push(d) });

    await fileDraft(ctx, drafts[0]);

    // Original survived; new content landed at the suffixed path.
    expect(await fsp.readFile(path.join(root, 'notes/colliding.md'), 'utf-8')).toBe('pre-existing\n');
    expect(await fsp.readFile(path.join(root, 'notes/colliding-2.md'), 'utf-8')).toBe('NEW\n');
  });
});
