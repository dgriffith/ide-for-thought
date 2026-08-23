/**
 * The name a proposal's note revisions carry in the History panel (#1843).
 *
 * Extracted from `approval.ts`, whose job is approval-tier policy and the
 * propose/approve/reject/expire lifecycle — not reading conversation storage to
 * build a UI string. The lifecycle still needs a label at apply time, so it
 * asks this module for one instead of knowing how a label is found.
 *
 * Skill-launched conversations are the case that makes this non-trivial: their
 * proposals are stamped only `llm:conversation:<id>`, so the skill's display
 * name has to come off the conversation itself. Best-effort throughout — a
 * failed lookup degrades to "Conversation" rather than failing an approval,
 * because a missing label is a cosmetic loss and a blocked approval is not.
 */
import * as conversation from './conversation';
import { describeProposalCause } from '../../shared/history';
import type { ProjectContext } from '../project-context-types';
import type { Proposal } from './proposal-types';

const CONVERSATION_PROPOSER = 'llm:conversation:';

export async function proposalCause(ctx: ProjectContext, proposal: Proposal): Promise<string> {
  let skillName: string | undefined;
  if (proposal.proposedBy.startsWith(CONVERSATION_PROPOSER)) {
    const convId = proposal.proposedBy.slice(CONVERSATION_PROPOSER.length);
    try {
      skillName = (await conversation.load(ctx.rootPath, convId))?.skill?.name;
    } catch (err) {
      console.warn(`[proposal-cause] could not resolve the skill behind ${proposal.uri}:`, err);
    }
  }
  return describeProposalCause({
    proposedBy: proposal.proposedBy,
    operationType: proposal.operationType,
    skillName,
  });
}
