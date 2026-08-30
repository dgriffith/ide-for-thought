/**
 * Note-history causes for AI-applied writes (#1158).
 *
 * A revision the user didn't type should say what produced it. The chain under
 * test is the real one, end to end: a proposal is approved → `applyBundle`
 * writes the note → the capture hook records a revision → its `cause` names the
 * skill behind the conversation (or the built-in write path), not the module
 * that happened to call `writeFile`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { proposeWrite, approveProposal } from '../../../src/main/llm/approval';
import * as conversation from '../../../src/main/llm/conversation';
import { listRevisions } from '../../../src/main/history';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('revision causes for approved proposals (#1158)', () => {
  const project = useGraphProject('minerva-history-cause-');
  let root: string;
  let ctx: ProjectContext;

  beforeEach(() => {
    root = project.root;
    ctx = project.ctx;
  });

  async function fileAndApprove(proposedBy: string, relativePath: string): Promise<void> {
    const proposal = await proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{ kind: 'note', relativePath, content: '# Filed\n' }],
      note: 'test',
      proposedBy,
    });
    expect((await approveProposal(ctx, proposal.uri)).ok).toBe(true);
  }

  it('names the skill that launched the conversation behind the proposal', async () => {
    const conv = await conversation.create(root, {}, undefined, {
      skill: { id: 'antithesize', name: 'Antithesize' },
    });
    await fileAndApprove(`llm:conversation:${conv.id}`, 'notes/from-skill.md');

    const revs = await listRevisions(root, 'notes/from-skill.md');
    expect(revs).toHaveLength(1);
    expect(revs[0]!.origin).toBe('proposal');
    expect(revs[0]!.cause).toBe('Antithesize');
  });

  it('falls back to "Conversation" for a freeform chat with no skill', async () => {
    const conv = await conversation.create(root, {});
    await fileAndApprove(`llm:conversation:${conv.id}`, 'notes/from-chat.md');
    expect((await listRevisions(root, 'notes/from-chat.md'))[0]!.cause).toBe('Conversation');
  });

  it('names a built-in write path even with no conversation to look up', async () => {
    await fileAndApprove('llm:auto-tag', 'notes/tagged.md');
    expect((await listRevisions(root, 'notes/tagged.md'))[0]!.cause).toBe('Auto-tag');
  });

  it('survives a conversation that is gone — the label degrades, the approval does not', async () => {
    await fileAndApprove('llm:conversation:conv-vanished', 'notes/orphan.md');
    expect((await listRevisions(root, 'notes/orphan.md'))[0]!.cause).toBe('Conversation');
  });
});
