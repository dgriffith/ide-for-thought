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
  api: { proposals: { list: listMock, approve: approveMock, reject: rejectMock } },
}));

import ProposalsPanel from '../../../src/renderer/lib/components/right-sidebar/ProposalsPanel.svelte';

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

afterEach(() => {
  cleanup();
  listMock.mockReset();
  approveMock.mockReset();
  rejectMock.mockReset();
});

/** Render, then wait for the onMount list() to resolve into the DOM. */
async function renderPanel() {
  const utils = render(ProposalsPanel, { revision: 0 });
  await utils.findByText('Crystallize claim about photosynthesis');
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

  it('clicking the Pending status tab re-queries the list filtered to pending', async () => {
    listMock.mockResolvedValue([pendingProposal()]);
    const { getByText } = await renderPanel();

    await fireEvent.click(getByText('Pending'));

    await waitFor(() => expect(listMock).toHaveBeenCalledWith('pending'));
  });
});
