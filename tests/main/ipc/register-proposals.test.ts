/**
 * Proposals IPC handlers (#1523), driven for real (#1924).
 *
 * `register-proposals.ts` owns `PROPOSAL_APPROVE` — the single channel through
 * which a human confirms an LLM write, and therefore the enforcement point of
 * the Trust Principle. Before this file its only test reference was
 * `no-project-contract.test.ts`, which asserts the project-less arm and nothing
 * else: 25% statements, 0% branches, while `ipc-registrar-coverage.test.ts`
 * reported it as "covered" because the registrar is merely imported (#1894).
 *
 * So this drives the registrar's real handlers against the real approval engine
 * and a real graph. Only the process edges are mocked — `electron` (ipcMain
 * capture, a fake window, `Notification`) and `window-manager` (which project a
 * window has open). `ipc/helpers` is deliberately NOT mocked: `withRootPath` /
 * `withRootPathOr` are the branch under test on the no-project arms, and a mock
 * of them would assert against a re-implementation rather than the real
 * `rootPathFromEvent` → `winFromEvent` → `getRootPath` chain (#1926).
 *
 * The load-bearing assertion is negative: after a reject, and after an approve
 * with no project open, the payload must be absent from the graph. That is what
 * "the payload cannot reach the graph without an approved proposal" means as a
 * test rather than as a comment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** What `getRootPath(win.id)` reports. `null` models "no project open". */
let openProject: string | null = null;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const { handlers, notifications, win, NotificationMock } = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  /** Every `new Notification(...)` the registrar constructs, in order. */
  const notifications: Array<{
    opts: { title: string; body: string };
    clickHandlers: Array<() => void>;
    show: ReturnType<typeof vi.fn>;
  }> = [];

  const win = {
    id: 7,
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };

  class NotificationMock {
    static isSupported = vi.fn(() => true);
    private readonly clickHandlers: Array<() => void> = [];
    readonly show = vi.fn();
    constructor(opts: { title: string; body: string }) {
      notifications.push({ opts, clickHandlers: this.clickHandlers, show: this.show });
    }
    on(event: string, fn: () => void): this {
      if (event === 'click') this.clickHandlers.push(fn);
      return this;
    }
  }

  return { handlers, notifications, win, NotificationMock };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
  BrowserWindow: { fromWebContents: () => win },
  Notification: NotificationMock,
  // `notebase/fs` imports `dialog` at module load; nothing here calls it.
  dialog: {},
}));

vi.mock('../../../src/main/window-manager', () => ({
  getRootPath: (id: number) => (id === win.id ? openProject : null),
  markPathHandled: vi.fn(),
  windowsForProject: () => [],
}));

import { registerProposals } from '../../../src/main/ipc/register-proposals';
import { proposeWrite, getProposal } from '../../../src/main/llm/approval';
import { findUnreviewedLLMWrites } from '../../../src/main/graph/integrity';
import { queryGraph } from '../../../src/main/graph/index';
import { Channels } from '../../../src/shared/channels';
import { useGraphProject } from '../../helpers/temp-project';
import type { ProjectContext } from '../../../src/main/project-context-types';

registerProposals();

/** Invoke a registered handler the way `ipcRenderer.invoke` would. */
const call = (channel: string, ...args: unknown[]) =>
  handlers.get(channel)!({ sender: {} }, ...args);

const CLAIM = 'urn:proposals-ipc:claim-1';

/**
 * Turtle for a `thought:Claim` (a `thought:Component` subclass) carrying LLM
 * provenance — the shape `findUnreviewedLLMWrites` hunts for, so the integrity
 * assertion below is about a node that would be flagged if it were unapproved,
 * not a node the query cannot see.
 */
const claimTurtle = (uri: string, label: string) =>
  `<${uri}> a thought:Claim ; thought:label "${label}" ; thought:extractedBy "llm:conversation:c1" .`;

describe('register-proposals (#1523) — the approval gate IPC surface', () => {
  const project = useGraphProject('minerva-proposals-ipc-');

  beforeEach(() => {
    vi.clearAllMocks();
    NotificationMock.isSupported.mockReturnValue(true);
    win.isDestroyed.mockReturnValue(false);
    win.isMinimized.mockReturnValue(false);
    notifications.length = 0;
    openProject = project.root;
  });

  /** File a pending proposal for one LLM-attributed claim. */
  async function fileClaim(uri = CLAIM, label = 'A proposed claim') {
    return proposeWrite(project.ctx, {
      operationType: 'new_claim',
      payloads: [{ kind: 'graph-triples', turtle: claimTurtle(uri, label), affectsNodeUris: [uri] }],
      note: 'register-proposals test',
      proposedBy: 'llm:conversation:c1',
    });
  }

  /** Is the payload's claim actually in the graph? */
  async function claimInGraph(ctx: ProjectContext, uri = CLAIM): Promise<boolean> {
    const r = await queryGraph(ctx, `SELECT ?t WHERE { <${uri}> a ?t . }`);
    return r.results.length > 0;
  }

  describe('PROPOSAL_APPROVE — the write reaches the graph only through an approval', () => {
    it('approving applies the payload and records the approved status', async () => {
      const proposal = await fileClaim();
      expect(await claimInGraph(project.ctx)).toBe(false);

      await expect(call(Channels.PROPOSAL_APPROVE, proposal.uri)).resolves.toBe(true);

      expect(await claimInGraph(project.ctx)).toBe(true);
      expect((await getProposal(project.ctx, proposal.uri))!.status).toBe('approved');
    });

    it('an approval through the channel leaves no unreviewed LLM write behind', async () => {
      const proposal = await fileClaim();
      await call(Channels.PROPOSAL_APPROVE, proposal.uri);

      // Non-vacuous: the component exists and is LLM-attributed, so the query
      // would flag it if the channel had applied it without an approved proposal.
      expect(await claimInGraph(project.ctx)).toBe(true);
      expect(await findUnreviewedLLMWrites(project.ctx)).toEqual([]);
    });

    it('rejecting applies nothing — the payload never reaches the graph', async () => {
      const proposal = await fileClaim();

      await expect(call(Channels.PROPOSAL_REJECT, proposal.uri)).resolves.toBe(true);

      expect(await claimInGraph(project.ctx)).toBe(false);
      expect((await getProposal(project.ctx, proposal.uri))!.status).toBe('rejected');
    });

    it('approving an already-rejected proposal returns false and still applies nothing', async () => {
      const proposal = await fileClaim();
      await call(Channels.PROPOSAL_REJECT, proposal.uri);

      await expect(call(Channels.PROPOSAL_APPROVE, proposal.uri)).resolves.toBe(false);

      expect(await claimInGraph(project.ctx)).toBe(false);
      expect((await getProposal(project.ctx, proposal.uri))!.status).toBe('rejected');
    });

    it('approving twice does not re-apply', async () => {
      const proposal = await fileClaim();
      await expect(call(Channels.PROPOSAL_APPROVE, proposal.uri)).resolves.toBe(true);
      await expect(call(Channels.PROPOSAL_APPROVE, proposal.uri)).resolves.toBe(false);
      expect((await getProposal(project.ctx, proposal.uri))!.status).toBe('approved');
    });

    it('approving an unknown URI returns false rather than throwing', async () => {
      await expect(call(Channels.PROPOSAL_APPROVE, 'urn:proposals-ipc:nope')).resolves.toBe(false);
    });

    it('rejecting an unknown URI returns false', async () => {
      await expect(call(Channels.PROPOSAL_REJECT, 'urn:proposals-ipc:nope')).resolves.toBe(false);
    });
  });

  // Note the assertion style here: `withRootPathOr` returns its fallback — and
  // `withRootPath` throws — *synchronously*, before the async handler body is
  // ever entered. So these arms yield a bare value, not a promise. That is
  // correct at the IPC boundary (`ipcMain.handle` turns a sync throw into a
  // rejected renderer promise either way) and worth pinning: a refactor that
  // made the guard async would change when the fallback is decided.
  describe('no project open', () => {
    it('PROPOSAL_APPROVE returns false and does not apply the payload', async () => {
      const proposal = await fileClaim();
      openProject = null;

      expect(call(Channels.PROPOSAL_APPROVE, proposal.uri)).toBe(false);

      openProject = project.root;
      expect(await claimInGraph(project.ctx)).toBe(false);
      expect((await getProposal(project.ctx, proposal.uri))!.status).toBe('pending');
    });

    it('PROPOSAL_REJECT returns false and leaves the proposal pending', async () => {
      const proposal = await fileClaim();
      openProject = null;

      expect(call(Channels.PROPOSAL_REJECT, proposal.uri)).toBe(false);

      openProject = project.root;
      expect((await getProposal(project.ctx, proposal.uri))!.status).toBe('pending');
    });

    it('PROPOSAL_LIST answers with an empty list', () => {
      openProject = null;
      expect(call(Channels.PROPOSAL_LIST)).toEqual([]);
    });

    it('PROPOSAL_EXPIRE answers 0', () => {
      openProject = null;
      expect(call(Channels.PROPOSAL_EXPIRE)).toBe(0);
    });

    // `withRootPath`, not `withRootPathOr`: "no project" must not fold into the
    // same `null` that means "no proposal at that URI" (#1841).
    it('PROPOSAL_DETAIL throws instead of returning null', () => {
      openProject = null;
      expect(() => call(Channels.PROPOSAL_DETAIL, CLAIM)).toThrow(/No project open/);
    });
  });

  describe('PROPOSAL_LIST / PROPOSAL_DETAIL', () => {
    it('lists the pending proposals for the open project', async () => {
      const proposal = await fileClaim();
      const listed = (await call(Channels.PROPOSAL_LIST)) as Array<{ uri: string; status: string }>;
      expect(listed.map((p) => p.uri)).toContain(proposal.uri);
    });

    it('filters by status', async () => {
      const approved = await fileClaim('urn:proposals-ipc:approved', 'Approved');
      const pending = await fileClaim('urn:proposals-ipc:pending', 'Pending');
      await call(Channels.PROPOSAL_APPROVE, approved.uri);

      const stillPending = (await call(Channels.PROPOSAL_LIST, 'pending')) as Array<{ uri: string }>;
      const uris = stillPending.map((p) => p.uri);
      expect(uris).toContain(pending.uri);
      expect(uris).not.toContain(approved.uri);
    });

    it('returns the proposal at a URI', async () => {
      const proposal = await fileClaim();
      const detail = (await call(Channels.PROPOSAL_DETAIL, proposal.uri)) as { uri: string; status: string };
      expect(detail.uri).toBe(proposal.uri);
      expect(detail.status).toBe('pending');
    });

    it('returns null for a URI with no proposal', async () => {
      await expect(call(Channels.PROPOSAL_DETAIL, 'urn:proposals-ipc:nope')).resolves.toBeNull();
    });
  });

  describe('PROPOSAL_EXPIRE', () => {
    it('expires a proposal past its window and leaves a fresh one alone', async () => {
      const stale = await proposeWrite(project.ctx, {
        operationType: 'new_claim',
        payloads: [{
          kind: 'graph-triples',
          turtle: claimTurtle('urn:proposals-ipc:stale', 'Stale'),
          affectsNodeUris: ['urn:proposals-ipc:stale'],
        }],
        note: 'already past its window',
        proposedBy: 'llm:conversation:c1',
        expiryDays: -1,
      });
      const fresh = await fileClaim('urn:proposals-ipc:fresh', 'Fresh');

      await expect(call(Channels.PROPOSAL_EXPIRE)).resolves.toBe(1);

      expect((await getProposal(project.ctx, stale.uri))!.status).toBe('expired');
      expect((await getProposal(project.ctx, fresh.uri))!.status).toBe('pending');
    });

    it('an expired proposal can no longer be approved', async () => {
      const stale = await proposeWrite(project.ctx, {
        operationType: 'new_claim',
        payloads: [{
          kind: 'graph-triples',
          turtle: claimTurtle('urn:proposals-ipc:stale-2', 'Stale'),
          affectsNodeUris: ['urn:proposals-ipc:stale-2'],
        }],
        note: 'already past its window',
        proposedBy: 'llm:conversation:c1',
        expiryDays: -1,
      });
      await call(Channels.PROPOSAL_EXPIRE);

      await expect(call(Channels.PROPOSAL_APPROVE, stale.uri)).resolves.toBe(false);
      expect(await claimInGraph(project.ctx, 'urn:proposals-ipc:stale-2')).toBe(false);
    });
  });

  describe('PROPOSALS_NOTIFY_ARRIVAL (#1541)', () => {
    it('shows a singular notification for one proposal', () => {
      call(Channels.PROPOSALS_NOTIFY_ARRIVAL, { count: 1, proposer: '' });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]!.opts.title).toBe('New proposal');
      expect(notifications[0]!.opts.body).toBe('Awaiting your review');
      expect(notifications[0]!.show).toHaveBeenCalled();
    });

    it('pluralises and names the proposer', () => {
      call(Channels.PROPOSALS_NOTIFY_ARRIVAL, { count: 3, proposer: 'Claude' });
      expect(notifications[0]!.opts.title).toBe('3 new proposals');
      expect(notifications[0]!.opts.body).toBe('Awaiting your review from Claude');
    });

    it('floors a nonsense count at 1', () => {
      call(Channels.PROPOSALS_NOTIFY_ARRIVAL, { count: 0, proposer: '' });
      expect(notifications[0]!.opts.title).toBe('New proposal');
    });

    it('defaults to 1 when the caller omits the count', () => {
      call(Channels.PROPOSALS_NOTIFY_ARRIVAL, { proposer: 'Claude' });
      expect(notifications[0]!.opts.title).toBe('New proposal');
      expect(notifications[0]!.opts.body).toBe('Awaiting your review from Claude');
    });

    it('does nothing when notifications are unsupported', () => {
      NotificationMock.isSupported.mockReturnValue(false);
      call(Channels.PROPOSALS_NOTIFY_ARRIVAL, { count: 2, proposer: 'Claude' });
      expect(notifications).toHaveLength(0);
    });

    it('clicking refocuses the window and asks the renderer to open the panel', () => {
      call(Channels.PROPOSALS_NOTIFY_ARRIVAL, { count: 1, proposer: '' });
      notifications[0]!.clickHandlers.forEach((fn) => fn());

      expect(win.show).toHaveBeenCalled();
      expect(win.focus).toHaveBeenCalled();
      expect(win.webContents.send).toHaveBeenCalledWith(Channels.PROPOSALS_SHOW);
    });

    it('clicking restores a minimized window first', () => {
      win.isMinimized.mockReturnValue(true);
      call(Channels.PROPOSALS_NOTIFY_ARRIVAL, { count: 1, proposer: '' });
      notifications[0]!.clickHandlers.forEach((fn) => fn());

      expect(win.restore).toHaveBeenCalled();
      expect(win.show).toHaveBeenCalled();
    });

    it('clicking a notification whose window is gone does nothing', () => {
      call(Channels.PROPOSALS_NOTIFY_ARRIVAL, { count: 1, proposer: '' });
      win.isDestroyed.mockReturnValue(true);
      notifications[0]!.clickHandlers.forEach((fn) => fn());

      expect(win.show).not.toHaveBeenCalled();
      expect(win.webContents.send).not.toHaveBeenCalled();
    });
  });
});
