/**
 * Branches (#2970): a child conversation is an ordinary transcript that
 * remembers its parent and the message it forked at, starts from a summary of
 * the parent plus its own instructions (or the full context), and is archived
 * with its parent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appendMessage, archive, create, listAll, load, setBranchOutcome } from '../../../src/main/llm/conversation';
import { archiveWithBranches, createBranch, descendantsOf, type BranchDeps } from '../../../src/main/llm/conversation-branch';
import * as graph from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';
import type { Conversation } from '../../../src/shared/conversation';

describe('conversation branches (#2970)', () => {
  const project = useGraphProject('minerva-conv-branch-test-');
  let root: string;
  let complete: ReturnType<typeof vi.fn>;
  let deps: BranchDeps;

  beforeEach(() => {
    root = project.root;
    complete = vi.fn(async (_p: string, o: { onUsage?: (u: { inputTokens: number; outputTokens: number }, m: string) => void }) => {
      o.onUsage?.({ inputTokens: 10, outputTokens: 5 }, 'claude-sonnet-5');
      return 'They are planning a launch.';
    });
    deps = { complete: complete as unknown as BranchDeps['complete'] };
  });

  async function parentWithTurns(): Promise<Conversation> {
    const p = await create(root, { notePath: 'plan.md' }, undefined, { skillContext: '<thoughtbase-content kind="note">x</thoughtbase-content>', model: 'claude-opus-5', systemPrompt: 'Be brief.' });
    await appendMessage(root, p.id, 'user', 'Plan the launch.');
    return appendMessage(root, p.id, 'assistant', 'Here is a plan.', { usage: { inputTokens: 100, outputTokens: 50 }, usageModel: 'claude-opus-5' });
  }

  it('a branch file round-trips its parent link and name', async () => {
    const parent = await parentWithTurns();
    const b = await createBranch(root, parent.id, { title: 'Risks', instructions: 'List the risks.' }, deps);
    const back = await load(root, b.id);
    expect(back?.branch).toEqual({ parentId: parent.id, atMessage: 2, context: 'summary' });
    expect(back?.title).toBe('Risks');
    expect(back?.titleSource).toBe('user');
    expect(back?.status).toBe('active');
    const outcome = await setBranchOutcome(root, b.id, 'done');
    expect(outcome?.branch?.outcome).toBe('done');
    expect((await load(root, b.id))?.branch?.outcome).toBe('done');
  });

  it('a summary-context branch starts with the summary and its instructions only', async () => {
    const parent = await parentWithTurns();
    const b = await createBranch(root, parent.id, { title: 'Risks', instructions: 'List the risks.' }, deps);
    expect(b.messages).toHaveLength(1);
    const [opening] = b.messages;
    expect(opening!.role).toBe('user');
    expect(opening!.content).toContain('They are planning a launch.');
    expect(opening!.content).toMatch(/\*\*This branch:\*\* List the risks\.$/);
    expect(opening!.content).not.toContain('Here is a plan.');
    // The summary call is the parent's transcript, on the parent's model, and its cost is the branch's.
    expect(complete.mock.calls[0]![0]).toContain('[user] Plan the launch.');
    expect(complete.mock.calls[0]![1]).toMatchObject({ model: 'claude-opus-5' });
    expect(opening!.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('keeps the parent\'s skill context, system prompt, model and scope', async () => {
    const parent = await parentWithTurns();
    const b = await createBranch(root, parent.id, { title: 'Risks' }, deps);
    expect(b.skillContext).toBe(parent.skillContext);
    expect(b.systemPrompt).toBe('Be brief.');
    expect(b.model).toBe('claude-opus-5');
    expect(b.contextBundle).toEqual({ notePath: 'plan.md' });
    const other = await createBranch(root, parent.id, { title: 'Cheaper', model: 'claude-haiku-5-5' }, deps);
    expect(other.model).toBe('claude-haiku-5-5');
  });

  it('a full-context branch copies the turns up to the fork, without their cost', async () => {
    const parent = await parentWithTurns();
    const b = await createBranch(root, parent.id, { title: 'Again', context: 'full', atMessage: 2, instructions: 'Try it another way.' }, deps);
    expect(complete).not.toHaveBeenCalled();
    expect(b.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Plan the launch.'], ['assistant', 'Here is a plan.'], ['user', 'Try it another way.'],
    ]);
    expect(b.messages[1]!.usage).toBeUndefined();
    const early = await createBranch(root, parent.id, { title: 'Early', context: 'full', atMessage: 1 }, deps);
    expect(early.messages.map((m) => m.content)).toEqual(['Plan the launch.']);
    expect(early.branch?.atMessage).toBe(1);
  });

  it('refuses a cut-off summary, an archived parent and a blank name', async () => {
    const parent = await parentWithTurns();
    const cut: BranchDeps = { complete: async (_p, o) => { o.onTruncated?.(); return 'half'; } };
    await expect(createBranch(root, parent.id, { title: 'X' }, cut)).rejects.toThrow(/cut off/);
    await expect(createBranch(root, parent.id, { title: '  ' }, deps)).rejects.toThrow(/name/);
    await archive(root, parent.id);
    await expect(createBranch(root, parent.id, { title: 'X' }, deps)).rejects.toThrow(/archived/);
  });

  it('archiving a parent archives its branches, and theirs, and nothing else', async () => {
    const parent = await parentWithTurns();
    const other = await create(root, {});
    const child = await createBranch(root, parent.id, { title: 'Child' }, deps);
    const grandchild = await createBranch(root, child.id, { title: 'Grandchild' }, deps);
    expect(descendantsOf(await listAll(root), parent.id).map((c) => c.id).sort()).toEqual([child.id, grandchild.id].sort());
    await archiveWithBranches(root, parent.id);
    expect((await load(root, child.id))?.status).toBe('archived');
    expect((await load(root, grandchild.id))?.status).toBe('archived');
    expect((await load(root, other.id))?.status).toBe('active');
  });

  it('the graph says which conversation a branch came from', async () => {
    const parent = await parentWithTurns();
    const b = await createBranch(root, parent.id, { title: 'Risks' }, deps);
    const rows = await graph.queryGraph(projectContext(root), `SELECT ?p WHERE { <https://minerva.dev/ontology/thought#conversation/${b.id}> prov:wasDerivedFrom ?p }`);
    expect(JSON.stringify(rows)).toContain(`conversation/${parent.id}`);
  });
});
