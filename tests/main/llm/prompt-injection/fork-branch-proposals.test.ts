/**
 * @vitest-environment node
 *
 * A fork's branch proposes; the user approves in the parent (#2973).
 *
 * The real `completeWithTools` loop runs both the parent and its branch, with
 * the SDK mocked at the client so the "model" follows a script: the parent
 * forks, and the branch calls `propose_notes`. Asserted on the system:
 * - the branch's draft reaches the parent labelled with the branch, and
 *   nothing is written until the user approves it;
 * - approved, the proposal is attributed to the branch's conversation;
 * - after the forked run, the integrity query (`findUnreviewedLLMWrites`)
 *   finds nothing unreviewed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { useGraphProject } from '../../../helpers/temp-project';
import { silenceLogTags } from '../../../helpers/quiet-logs';

const { streamMock, getSettingsMock } = vi.hoisted(() => ({ streamMock: vi.fn(), getSettingsMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { stream: streamMock };
    beta = { messages: { stream: streamMock } };
  },
}));
vi.mock('../../../../src/main/llm/settings', () => ({ getSettings: getSettingsMock }));
vi.mock('../../../../src/main/mcp-servers/config-store', () => ({
  getStoredServers: vi.fn(async () => []),
  addStoredServer: vi.fn(), updateStoredServer: vi.fn(), setStoredServerEnabled: vi.fn(), removeStoredServer: vi.fn(),
}));

import { completeWithTools, type StreamCallbacks } from '../../../../src/main/llm/index';
import { runFork, branchInstructions, type ForkBranchSpec } from '../../../../src/main/llm/fork';
import { proposeWrite, approveProposal } from '../../../../src/main/llm/approval';
import { getProposal, listProposals } from '../../../../src/main/llm/proposal-persistence';
import { findUnreviewedLLMWrites } from '../../../../src/main/graph/integrity';
import type { Conversation, ForkBranchLabel } from '../../../../src/shared/conversation';
import type { ConversationDraft } from '../../../../src/shared/conversation-drafts';

silenceLogTags('llm', 'conversation');

function message(stop: 'tool_use' | 'end_turn', content: unknown[]): Anthropic.Message {
  return {
    id: `msg-${crypto.randomUUID()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
    stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } as unknown as Anthropic.Usage, content,
  } as unknown as Anthropic.Message;
}
const toolTurn = (id: string, name: string, input: unknown) => message('tool_use', [{ type: 'tool_use', id, name, input }]);
const text = (t: string) => message('end_turn', [{ type: 'text', text: t, citations: null }]);

describe('a branch proposes, the user approves in the parent (#2973)', () => {
  const project = useGraphProject('minerva-fork-proposals-');

  beforeEach(() => {
    streamMock.mockReset();
    getSettingsMock.mockResolvedValue({
      providers: { anthropic: { apiKey: 'fake' } }, model: 'claude-sonnet-4-6',
      web: { enabled: false, allowedDomains: [], blockedDomains: [] },
    });
  });

  it('the draft is labelled for the parent, attributed to the branch, and nothing is unreviewed', async () => {
    // Who is asking decides the script: the branch's opening says so.
    let parentTurns = 0;
    let branchTurns = 0;
    streamMock.mockImplementation((args: { messages: unknown }) => {
      const isBranch = JSON.stringify(args.messages).includes('You are one branch of a fork');
      const turn = isBranch
        ? [
          toolTurn('tu-p', 'propose_notes', { note: 'the risks, filed', payloads: [{ kind: 'note', relativePath: 'notes/risks.md', content: '# Risks\n\nCost.\n' }] }),
          text('I proposed a note on the risks.'),
        ][Math.min(branchTurns++, 1)]!
        : [toolTurn('tu-fork', 'fork', { branches: [{ title: 'Risks', instructions: 'List the risks and file them.' }] }), text('Done.')][Math.min(parentTurns++, 1)]!;
      return { on: () => undefined, finalMessage: async () => turn };
    });

    const parent: Conversation = { id: 'conv-parent', contextBundle: {}, messages: [], status: 'active', startedAt: 't' };
    const drafts: (ConversationDraft & { branch?: ForkBranchLabel })[] = [];
    const runBranches = (specs: ForkBranchSpec[]) => runFork({
      parent, signal: new AbortController().signal, maxBranches: 4, confirmAboveUsd: 1, timeBudgetMs: 60_000,
      createBranch: async (spec) => ({
        ...parent, id: 'conv-branch', title: spec.title, branch: { parentId: parent.id, atMessage: 0, context: 'summary' },
        messages: [{ role: 'user', content: branchInstructions(spec), timestamp: 't' }],
      }),
      runTurn: async (branch) => {
        // The registrar's routing, in miniature: the branch's draft goes to the parent, labelled.
        const label: ForkBranchLabel = { parentId: parent.id, title: branch.title! };
        const result = await completeWithTools({
          system: 'sys', messages: [{ role: 'user', content: branch.messages[0]!.content }],
          toolContext: { rootPath: project.root, conversationId: branch.id },
          callbacks: { onChunk: () => {}, onDraft: (d) => drafts.push({ ...d, branch: label }) },
        });
        return { ...branch, messages: [...branch.messages, { role: 'assistant', content: result.text, timestamp: 't' }] };
      },
    }, specs);

    const callbacks: StreamCallbacks = { onChunk: () => {}, runBranches };
    await completeWithTools({
      system: 'sys', messages: [{ role: 'user', content: 'What are the risks?' }],
      toolContext: { rootPath: project.root, conversationId: parent.id }, callbacks,
    });

    // The branch's draft, for the parent's transcript; nothing written, nothing filed.
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ conversationId: 'conv-branch', branch: { parentId: 'conv-parent', title: 'Risks' } });
    expect(fs.existsSync(path.join(project.root, 'notes/risks.md'))).toBe(false);
    expect(await listProposals(project.ctx)).toEqual([]);

    // The user approves it from the parent: filed with the provenance the draft
    // handler gives it — the branch's own conversation.
    const proposal = await proposeWrite(project.ctx, {
      operationType: 'component_creation', payloads: drafts[0]!.payloads, note: drafts[0]!.note,
      proposedBy: `llm:conversation:${drafts[0]!.conversationId}`,
      conversationUri: `https://minerva.dev/ontology/thought#conversation/${drafts[0]!.conversationId}`,
    });
    expect((await approveProposal(project.ctx, proposal.uri)).ok).toBe(true);
    expect(fs.readFileSync(path.join(project.root, 'notes/risks.md'), 'utf-8')).toContain('Cost.');
    expect((await getProposal(project.ctx, proposal.uri))!.proposedBy).toBe('llm:conversation:conv-branch');

    expect(await findUnreviewedLLMWrites(project.ctx)).toEqual([]);
  });
});
