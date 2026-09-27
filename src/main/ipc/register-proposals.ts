/**
 * Proposals IPC (#1523) — the approval-queue surface: list / detail / approve /
 * reject / expire, plus the native OS arrival notification (#1541). Split out of
 * register-conversation.ts (arch D4 / #1623): proposals are their own domain (the
 * left Proposals panel + status badge), distinct from the conversation lifecycle.
 * Every write still flows through the approval engine (the Trust Principle).
 */
import { Notification } from 'electron';
import { Channels } from '../../shared/channels';
import { broadcast } from './broadcast';
import * as approval from '../llm/approval';
import type { Proposal } from '../llm/approval';
import type { ProposalApproveResult, ProposalDecisionFailure, ProposalRejectResult } from '../../shared/proposals';
import { projectContext, type ProjectContext } from '../project-context-types';
import { withRootPath, withRootPathOr, winFromEvent } from './helpers';
import { handle } from './typed-ipc';

export function registerProposals(): void {
  handle(Channels.PROPOSAL_LIST, withRootPathOr<[string?], Proposal[] | Promise<Proposal[]>>([], (rootPath, status?: string) =>
    approval.listProposals(projectContext(rootPath), status)));
  // `null` = no proposal at that URI (expired, rejected-and-swept, bad URI).
  // "No project open" throws instead of folding into the same `null` (#1841).
  handle(Channels.PROPOSAL_DETAIL, withRootPath((rootPath, uri: string) =>
    approval.getProposal(projectContext(rootPath), uri)));
  // Approve / reject (#2362): "no project open" throws (`withRootPath`), and an
  // expected refusal — no proposal at that URI, or one already resolved —
  // comes back as `{ ok: false, reason }` rather than a bare `false` that also
  // meant "no project". An apply that fails outright still throws.
  handle(Channels.PROPOSAL_APPROVE, withRootPath(async (rootPath, uri: string): Promise<ProposalApproveResult> => {
    const ctx = projectContext(rootPath);
    const result = await approval.approveProposal(ctx, uri);
    if (result.ok) return { ok: true, filedPaths: result.filedPaths, rewrittenPaths: result.rewrittenPaths };
    return whyNotDecided(ctx, uri);
  }));
  handle(Channels.PROPOSAL_REJECT, withRootPath(async (rootPath, uri: string): Promise<ProposalRejectResult> => {
    const ctx = projectContext(rootPath);
    if (await approval.rejectProposal(ctx, uri)) return { ok: true };
    return whyNotDecided(ctx, uri);
  }));
  handle(Channels.PROPOSAL_EXPIRE, withRootPathOr<[], number | Promise<number>>(0, (rootPath) =>
    approval.expireProposals(projectContext(rootPath))));

  // Native OS notification for a proposal that arrived while Minerva was
  // unfocused (#1541). The renderer owns arrival detection + focus gating and
  // only calls this when the app isn't foregrounded; clicking the notification
  // refocuses the window and asks the renderer to open the Proposals panel.
  handle(Channels.PROPOSALS_NOTIFY_ARRIVAL, (e, arg: { count: number; proposer: string }) => {
    if (!Notification.isSupported()) return;
    const count = Math.max(1, arg?.count ?? 1);
    const from = arg?.proposer ? ` from ${arg.proposer}` : '';
    const title = count === 1 ? 'New proposal' : `${count} new proposals`;
    const notice = new Notification({ title, body: `Awaiting your review${from}` });
    const win = winFromEvent(e);
    notice.on('click', () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      broadcast(win, Channels.PROPOSALS_SHOW);
    });
    notice.show();
  });
}

/**
 * Classify an approve/reject the engine declined. `approveProposal` /
 * `rejectProposal` answer only "not decided" (they refuse exactly when the
 * proposal is missing or no longer pending), so re-read it to say which — the
 * reviewer sees "already rejected" instead of a guess (#2362).
 */
async function whyNotDecided(ctx: ProjectContext, uri: string): Promise<ProposalDecisionFailure> {
  const proposal = await approval.getProposal(ctx, uri);
  if (!proposal) return { ok: false, reason: 'not-found' };
  return { ok: false, reason: 'not-pending', status: proposal.status };
}
