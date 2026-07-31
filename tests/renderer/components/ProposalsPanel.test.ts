/**
 * @vitest-environment happy-dom
 *
 * Component-interaction coverage for the approval diff UI (#680, QA Q-H4).
 *
 * ProposalsPanel is the human-confirm step of the Trust Principle — where the
 * user actually approves or rejects LLM-originated graph writes. Until now it
 * was exercised only by the E2E smoke (which never opens a project), so the
 * in-the-loop interaction was untested. These tests render the real component
 * against a mocked `api.proposals` boundary and assert that approve / reject —
 * by button AND by the y/n keystrokes — reach the IPC layer with the right URI.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

const { listMock, approveMock, rejectMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  approveMock: vi.fn(),
  rejectMock: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    // The proposals store's start() subscribes to these on first access; return
    // no-op unsubscribers so getProposalsStore() initialises under test.
    proposals: { list: listMock, approve: approveMock, reject: rejectMock, onChanged: () => () => {} },
    menu: { onProjectOpened: () => () => {} },
  },
}));

import ProposalsPanel from '../../../src/renderer/lib/components/ProposalsPanel.svelte';
import { getProposalsStore } from '../../../src/renderer/lib/stores/proposals.svelte';

interface Payload { kind: string; [k: string]: unknown }
function pendingProposal(over: Record<string, unknown> = {}) {
  return {
    uri: 'urn:proposal:1',
    status: 'pending',
    operationType: 'component_creation',
    note: 'Crystallize claim about photosynthesis',
    proposedBy: 'llm:test',
    proposedAt: '2026-01-01T00:00:00Z',
    payloads: [
      { kind: 'note', relativePath: 'notes/claim.md', content: '# Claim' },
      { kind: 'graph-triples', turtle: '<urn:c> a thought:Claim .', affectsNodeUris: ['urn:c'] },
    ] as Payload[],
    ...over,
  };
}

afterEach(async () => {
  cleanup();
  // The proposals store is a module singleton; drain it between tests so a
  // prior test's data can't leak into the next render.
  listMock.mockResolvedValue([]);
  await getProposalsStore().refresh();
  listMock.mockReset();
  approveMock.mockReset();
  rejectMock.mockReset();
});

/**
 * Populate the proposals store (as App does at boot — the panel reads
 * `store.proposals`, it no longer fetches on mount) and render. The store's
 * `refresh()` pulls through the mocked `api.proposals.list`; approve/reject
 * still route through the review store to `api.proposals.approve/reject`.
 */
async function renderPanel(proposals: ReturnType<typeof pendingProposal>[] = [pendingProposal()]) {
  listMock.mockResolvedValue(proposals);
  await getProposalsStore().refresh();
  const utils = render(ProposalsPanel);
  if (proposals.length > 0) await utils.findByText(proposals[0]!.note);
  return utils;
}

describe('ProposalsPanel — approval diff UI (#680)', () => {
  it('renders proposals from api.proposals.list with a plain-language effects summary', async () => {
    listMock.mockResolvedValue([pendingProposal()]);
    const { getByText } = await renderPanel();
    // bundleEffectsSummary should read the note + the typed triple, not "2 triples".
    expect(getByText(/Will create:.*1 note.*1 Claim/)).toBeTruthy();
  });

  it('selecting a proposal reveals Approve/Reject; Approve reaches IPC and shows the success banner', async () => {
    listMock.mockResolvedValue([pendingProposal()]);
    approveMock.mockResolvedValue(true);
    const { getByText, findByText } = await renderPanel();

    await fireEvent.click(getByText('Crystallize claim about photosynthesis'));
    await fireEvent.click(getByText('Approve (y)'));

    expect(approveMock).toHaveBeenCalledWith('urn:proposal:1');
    expect(await findByText(/Approved — landed/)).toBeTruthy();
  });

  it('Reject button reaches api.proposals.reject with the proposal URI', async () => {
    listMock.mockResolvedValue([pendingProposal()]);
    rejectMock.mockResolvedValue(true);
    const { getByText } = await renderPanel();

    await fireEvent.click(getByText('Crystallize claim about photosynthesis'));
    await fireEvent.click(getByText('Reject (n)'));

    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith('urn:proposal:1'));
  });

  it('the "y" keystroke approves the selected proposal (Trust keyboard path)', async () => {
    listMock.mockResolvedValue([pendingProposal()]);
    approveMock.mockResolvedValue(true);
    const { getByText, container } = await renderPanel();

    await fireEvent.click(getByText('Crystallize claim about photosynthesis'));
    const panel = container.querySelector('.proposals-panel')!;
    await fireEvent.keyDown(panel, { key: 'y' });

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('urn:proposal:1'));
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it('the "n" keystroke rejects the selected proposal', async () => {
    listMock.mockResolvedValue([pendingProposal()]);
    rejectMock.mockResolvedValue(true);
    const { getByText, container } = await renderPanel();

    await fireEvent.click(getByText('Crystallize claim about photosynthesis'));
    const panel = container.querySelector('.proposals-panel')!;
    await fireEvent.keyDown(panel, { key: 'n' });

    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith('urn:proposal:1'));
    expect(approveMock).not.toHaveBeenCalled();
  });

  it('a false approve result surfaces the stale/already-resolved error banner (no silent failure)', async () => {
    listMock.mockResolvedValue([pendingProposal()]);
    approveMock.mockResolvedValue(false);
    const { getByText, findByText } = await renderPanel();

    await fireEvent.click(getByText('Crystallize claim about photosynthesis'));
    await fireEvent.click(getByText('Approve (y)'));

    expect(await findByText(/Approve returned false/)).toBeTruthy();
  });

  it('status tabs filter the loaded set client-side (no re-query)', async () => {
    // The store now holds the FULL set; the panel filters by status locally
    // (#1525), so switching tabs must not hit IPC again.
    const pending = pendingProposal();
    const approved = pendingProposal({
      uri: 'urn:proposal:2',
      status: 'approved',
      note: 'Already approved thing',
    });
    const { getByText, queryByText } = await renderPanel([pending, approved]);
    listMock.mockClear();

    // "All" shows both.
    expect(getByText('Crystallize claim about photosynthesis')).toBeTruthy();
    expect(getByText('Already approved thing')).toBeTruthy();

    // Switching to "Approved" hides the pending one, locally — no new list() call.
    await fireEvent.click(getByText('Approved'));
    await waitFor(() => expect(queryByText('Crystallize claim about photosynthesis')).toBeNull());
    expect(getByText('Already approved thing')).toBeTruthy();
    expect(listMock).not.toHaveBeenCalled();
  });
});
