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
import { projectContext } from '../project-context-types';
import { withRootPath, withRootPathOr, winFromEvent } from './helpers';
import { handle } from './typed-ipc';

export function registerProposals(): void {
  handle(Channels.PROPOSAL_LIST, withRootPathOr<[string?], Proposal[] | Promise<Proposal[]>>([], (rootPath, status?: string) =>
    approval.listProposals(projectContext(rootPath), status)));
  // `null` = no proposal at that URI (expired, rejected-and-swept, bad URI).
  // "No project open" throws instead of folding into the same `null` (#1841).
  handle(Channels.PROPOSAL_DETAIL, withRootPath((rootPath, uri: string) =>
    approval.getProposal(projectContext(rootPath), uri)));
  handle(Channels.PROPOSAL_APPROVE, withRootPathOr<[string], boolean | Promise<boolean>>(false, async (rootPath, uri: string) => {
    const result = await approval.approveProposal(projectContext(rootPath), uri);
    return result.ok;
  }));
  handle(Channels.PROPOSAL_REJECT, withRootPathOr<[string], boolean | Promise<boolean>>(false, (rootPath, uri: string) =>
    approval.rejectProposal(projectContext(rootPath), uri)));
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
