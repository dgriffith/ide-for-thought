/**
 * @vitest-environment happy-dom
 *
 * Render coverage for conversations/DraftCards.svelte (#2354) — the stack that
 * renders a conversation tab's pending drafts after the message each is
 * anchored to, dispatches each draft kind to its review card, and routes the
 * card's Approve / Discard to the matching conversations-store method.
 *
 * This is the wiring layer of the Trust Principle's "human confirms" half: a
 * card can render perfectly and still approve the WRONG draft if the stack
 * closes over the wrong one. So every kind is exercised with TWO drafts and the
 * second one's button is clicked, asserting the store saw that draft (or its
 * id) and the tab id — never the first.
 *
 * The conversations + editor stores are mocked as modules (#1944).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { TabRuntime } from '../../../src/renderer/lib/stores/conversations.svelte';

const h = vi.hoisted(() => ({
  store: {
    approveDraft: vi.fn(),
    discardDraft: vi.fn(),
    approveRefactorDraft: vi.fn(),
    discardRefactorDraft: vi.fn(),
    approveReorgDraft: vi.fn(),
    discardReorgDraft: vi.fn(),
    approveDeleteDraft: vi.fn(),
    discardDeleteDraft: vi.fn(),
    approveNoteBodyDraft: vi.fn(),
    discardNoteBodyDraft: vi.fn(),
    approveSourceDraft: vi.fn(),
    discardSourceDraft: vi.fn(),
    approvePropertyDraft: vi.fn(),
    discardPropertyDraft: vi.fn(),
    approveSourcePropertyDraft: vi.fn(),
    discardSourcePropertyDraft: vi.fn(),
    approveClaimsDraft: vi.fn(),
    discardClaimsDraft: vi.fn(),
    runComputeDraft: vi.fn(),
    insertComputeDraft: vi.fn(),
    discardComputeDraft: vi.fn(),
  },
  editor: { openFile: vi.fn(), openSource: vi.fn() },
  logError: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({
  getConversationsStore: () => h.store,
}));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({
  getEditorStore: () => h.editor,
}));
vi.mock('../../../src/shared/logger', () => ({
  logger: () => ({ error: h.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import DraftCards from '../../../src/renderer/lib/components/conversations/DraftCards.svelte';

// ── fixtures ────────────────────────────────────────────────────────────────

const base = (id: string, at = 0) => ({
  draftId: id,
  conversationId: 'conv-1',
  createdAt: '2026-01-01T00:00:00Z',
  note: `note for ${id}`,
  afterMessageIndex: at,
});

const noteDraft = (id: string, path: string, at = 0) => ({
  ...base(id, at),
  payloads: [{ kind: 'note' as const, relativePath: path, content: `# ${path} body` }],
});
const sourceDraft = (id: string, identifier: string, at = 0) => ({
  ...base(id, at), sources: [{ identifier }],
});
const propertyDraft = (id: string, path: string, at = 0) => ({
  ...base(id, at), updates: [{ relativePath: path, properties: { status: 'done', stale: null } }], warnings: [] as string[],
});
const sourcePropertyDraft = (id: string, sourceId: string, at = 0) => ({
  ...base(id, at), sourceId, abstract: `abstract of ${sourceId}`, tldr: `tldr of ${sourceId}`,
});
const claimsDraft = (id: string, text: string, at = 0) => ({
  ...base(id, at),
  sourceId: 'src-1',
  claims: [{ text, kind: 'thesis', quote: `quote for ${text}`, confidence: 0.8, excerptId: 'e1', quoteFound: true }],
});
const computeDraft = (id: string, code: string, at = 0) => ({
  ...base(id, at), language: 'python', code, rationale: `why ${id}`, safetyFlags: [],
});
const refactorDraft = (id: string, fromPath: string, toPath: string, at = 0, isFolder?: boolean) => ({
  ...base(id, at), fromPath, toPath, affectedNotes: [], isFolder,
});
const reorgDraft = (id: string, fromPath: string, toPath: string, at = 0) => ({
  ...base(id, at), items: [{ fromPath, toPath, affectedNotes: [] }], warnings: [] as string[],
});
const deleteDraft = (id: string, path: string, at = 0) => ({
  ...base(id, at), items: [{ path, title: path, inbound: [] }], warnings: [] as string[],
});
const noteBodyDraft = (id: string, path: string, at = 0) => ({
  ...base(id, at), items: [{ relativePath: path, beforeContent: 'old', afterContent: 'new' }], warnings: [] as string[],
});

function tab(over: Partial<Record<keyof TabRuntime, unknown>> = {}, messageCount = 1): TabRuntime {
  return {
    id: 'tab-7',
    title: null,
    conversation: {
      id: 'conv-1',
      contextBundle: {},
      messages: Array.from({ length: messageCount }, (_, i) => ({ role: 'assistant', content: `m${i}`, timestamp: 't' })),
      status: 'active',
      startedAt: 't',
    },
    drafts: [], sourceDrafts: [], sourceDraftResults: {}, noteDraftResults: {},
    propertyDrafts: [], propertyDraftResults: {}, sourcePropertyDrafts: [],
    sourcePropertyDraftResults: {}, claimsDrafts: [], claimsDraftResults: {},
    computeDrafts: [], refactorDrafts: [], reorgDrafts: [], deleteDrafts: [],
    noteBodyDrafts: [], computeDraftState: {}, pendingQuestion: null, pendingMcpConfirm: null,
    composer: '', streaming: false, streamedChunks: '', failure: null, extraTools: [],
    ...over,
  } as unknown as TabRuntime;
}

function renderStack(t: TabRuntime, index: number | null = 0) {
  return render(DraftCards, { tab: t, index });
}

/** The Nth draft card's buttons, by visible label. */
function cards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.draft-card'));
}
function button(card: HTMLElement, label: RegExp): HTMLButtonElement {
  const b = Array.from(card.querySelectorAll('button')).find((x) => label.test(x.textContent ?? ''));
  if (!b) throw new Error(`no button matching ${label} in card: ${card.textContent}`);
  return b;
}
const approveBtn = (card: HTMLElement) => card.querySelector<HTMLButtonElement>('.draft-btn.primary')!;
const discardBtn = (card: HTMLElement) => button(card, /^Discard$/);

beforeEach(() => {
  for (const fn of Object.values(h.store)) fn.mockReset();
  h.store.approveDraft.mockResolvedValue({ filedPaths: [] });
  for (const k of [
    'approveRefactorDraft', 'approveReorgDraft', 'approveDeleteDraft', 'approveNoteBodyDraft',
    'approveSourceDraft', 'approvePropertyDraft', 'approveSourcePropertyDraft', 'approveClaimsDraft',
    'runComputeDraft', 'insertComputeDraft',
  ] as const) h.store[k].mockResolvedValue(undefined);
  h.editor.openFile.mockReset().mockResolvedValue(undefined);
  h.editor.openSource.mockReset();
  h.logError.mockReset();
});

afterEach(cleanup);

// ── empty / anchoring ───────────────────────────────────────────────────────

describe('DraftCards — empty and anchoring', () => {
  it('renders nothing for a tab with no drafts or results', () => {
    const { container } = renderStack(tab());
    expect(container.textContent.trim()).toBe('');
  });

  it('renders only drafts anchored to this stack\'s message index', () => {
    const t = tab({ drafts: [noteDraft('n0', 'zero.md', 0), noteDraft('n1', 'one.md', 1)] }, 3);
    const { container } = renderStack(t, 1);
    expect(container.textContent).toContain('one.md');
    expect(container.textContent).not.toContain('zero.md');
  });

  it('with index=null renders the orphans anchored past the message list', () => {
    const t = tab({
      drafts: [noteDraft('n0', 'anchored.md', 0), noteDraft('n5', 'orphan.md', 5), noteDraft('n2', 'edge.md', 2)],
    }, 2);
    const { container } = renderStack(t, null);
    expect(container.textContent).toContain('orphan.md');
    expect(container.textContent).toContain('edge.md');
    expect(container.textContent).not.toContain('anchored.md');
  });

  it('with index=null picks orphaned RESULT lines too', () => {
    const t = tab({
      noteDraftResults: {
        old: { filedPaths: ['inline.md'], afterMessageIndex: 0 },
        late: { filedPaths: ['late.md'], afterMessageIndex: 4 },
      },
    }, 1);
    const { container } = renderStack(t, null);
    expect(container.textContent).toContain('late.md');
    expect(container.textContent).not.toContain('inline.md');
  });

  it('renders one card of each kind, each with its own operation label', () => {
    const t = tab({
      drafts: [noteDraft('n', 'n.md')],
      sourceDrafts: [sourceDraft('s', '10.1/abc')],
      propertyDrafts: [propertyDraft('p', 'p.md')],
      sourcePropertyDrafts: [sourcePropertyDraft('sp', 'src-9')],
      claimsDrafts: [claimsDraft('c', 'A claim')],
      computeDrafts: [computeDraft('co', 'print(42)')],
      refactorDrafts: [refactorDraft('r', 'a/x.md', 'a/y.md')],
      reorgDrafts: [reorgDraft('ro', 'a.md', 'b/a.md')],
      deleteDrafts: [deleteDraft('d', 'gone.md')],
      noteBodyDrafts: [noteBodyDraft('nb', 'body.md')],
    });
    const { container } = renderStack(t);
    const headlines = Array.from(container.querySelectorAll('.draft-summary strong')).map((s) => s.textContent.trim());
    expect(headlines).toEqual([
      '1 note',
      '📚 1 source',
      '🔑 1 note',
      '📄 Source summary',
      '🧩 1 claim',
      'Rename',
      'Reorganize',
      'Delete',
      'Rewrite',
    ]);
    // Compute uses its own chrome (no .draft-summary), so check it separately.
    expect(container.textContent).toContain('print(42)');
  });
});

// ── the five DraftCard-shell kinds ─────────────────────────────────────────

describe('DraftCards — propose_notes', () => {
  const t = () => tab({ drafts: [noteDraft('n1', 'first.md'), noteDraft('n2', 'second.md')] });

  it('pluralises the headline for several payloads', () => {
    const d = { ...noteDraft('n', 'a.md'), payloads: [
      { kind: 'note' as const, relativePath: 'a.md', content: 'A' },
      { kind: 'note' as const, relativePath: 'b.md', content: 'B' },
    ] };
    const { container } = renderStack(tab({ drafts: [d] }));
    expect(container.querySelector('.draft-summary strong')!.textContent).toBe('2 notes');
  });

  it('shows the target path and the rationale', () => {
    const { container } = renderStack(t());
    const c = cards(container)[1]!;
    expect(c.textContent).toContain('second.md');
    expect(c.textContent).toContain('note for n2');
  });

  it('expands a payload to show its body, and collapses it again', async () => {
    const { container } = renderStack(t());
    const c = cards(container)[1]!;
    const toggle = c.querySelector<HTMLButtonElement>('.draft-path-btn')!;
    await fireEvent.click(toggle);
    expect(c.querySelector('.draft-preview')!.textContent).toBe('# second.md body');
    expect(cards(container)[0]!.querySelector('.draft-preview')).toBeNull();
    await fireEvent.click(toggle);
    expect(c.querySelector('.draft-preview')).toBeNull();
  });

  it('Approve on the SECOND card approves the second draft in this tab', async () => {
    const tt = t();
    const { container } = renderStack(tt);
    await fireEvent.click(approveBtn(cards(container)[1]!));
    expect(h.store.approveDraft).toHaveBeenCalledWith('tab-7', tt.drafts[1]);
    expect(h.store.approveDraft).toHaveBeenCalledTimes(1);
  });

  it('opens the first filed note after approval', async () => {
    h.store.approveDraft.mockResolvedValue({ filedPaths: ['filed/a.md', 'filed/b.md'] });
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.editor.openFile).toHaveBeenCalledWith('filed/a.md'));
  });

  it('opens nothing when approval filed nothing', async () => {
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.store.approveDraft).toHaveBeenCalled());
    expect(h.editor.openFile).not.toHaveBeenCalled();
  });

  it('logs, rather than throws, when approval fails', async () => {
    h.store.approveDraft.mockRejectedValue(new Error('boom'));
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith('approve failed:', expect.any(Error)));
  });

  it('Discard on the SECOND card discards the second draft id', async () => {
    const { container } = renderStack(t());
    await fireEvent.click(discardBtn(cards(container)[1]!));
    expect(h.store.discardDraft).toHaveBeenCalledWith('tab-7', 'n2');
    expect(h.store.approveDraft).not.toHaveBeenCalled();
  });
});

describe('DraftCards — propose_sources', () => {
  const t = () => tab({ sourceDrafts: [sourceDraft('s1', '10.1000/first'), sourceDraft('s2', 'https://example.org/x')] });

  it('shows each source with its kind pill', () => {
    const { container } = renderStack(t());
    expect(cards(container)[0]!.querySelector('.source-kind')!.textContent).toBe('doi');
    expect(cards(container)[1]!.querySelector('.source-value')!.textContent).toBe('https://example.org/x');
  });

  it('Approve on the second card ingests the second draft', async () => {
    const tt = t();
    const { container } = renderStack(tt);
    await fireEvent.click(approveBtn(cards(container)[1]!));
    expect(h.store.approveSourceDraft).toHaveBeenCalledWith('tab-7', tt.sourceDrafts[1]);
  });

  it('Discard on the second card discards the second id', async () => {
    const { container } = renderStack(t());
    await fireEvent.click(discardBtn(cards(container)[1]!));
    expect(h.store.discardSourceDraft).toHaveBeenCalledWith('tab-7', 's2');
  });

  it('logs a failed approval', async () => {
    h.store.approveSourceDraft.mockRejectedValue(new Error('x'));
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith('approve source failed:', expect.any(Error)));
  });
});

describe('DraftCards — set_properties', () => {
  const t = () => tab({ propertyDrafts: [propertyDraft('p1', 'first.md'), propertyDraft('p2', 'second.md')] });

  it('shows the target path and each key with its value, deletions marked', () => {
    const { container } = renderStack(t());
    const c = cards(container)[1]!;
    expect(c.querySelector('.property-update-path')!.textContent).toBe('second.md');
    const kvs = Array.from(c.querySelectorAll('.property-kv'));
    expect(kvs.map((k) => k.textContent.replace(/\s+/g, ' ').trim())).toEqual(['status: done', 'stale: ⌫ deleted']);
    expect(kvs[1]!.classList.contains('property-kv-delete')).toBe(true);
  });

  it('renders warnings when present', () => {
    const d = { ...propertyDraft('p', 'a.md'), warnings: ['missing.md: no such note'] };
    const { container } = renderStack(tab({ propertyDrafts: [d] }));
    expect(container.querySelector('.warnings')!.textContent).toContain('missing.md: no such note');
  });

  it('Approve on the second card applies the second draft', async () => {
    const tt = t();
    const { container } = renderStack(tt);
    await fireEvent.click(approveBtn(cards(container)[1]!));
    expect(h.store.approvePropertyDraft).toHaveBeenCalledWith('tab-7', tt.propertyDrafts[1]);
  });

  it('Discard on the second card discards the second id', async () => {
    const { container } = renderStack(t());
    await fireEvent.click(discardBtn(cards(container)[1]!));
    expect(h.store.discardPropertyDraft).toHaveBeenCalledWith('tab-7', 'p2');
  });

  it('logs a failed approval', async () => {
    h.store.approvePropertyDraft.mockRejectedValue(new Error('x'));
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith('approve property failed:', expect.any(Error)));
  });
});

describe('DraftCards — propose_source_properties', () => {
  const t = () => tab({ sourcePropertyDrafts: [sourcePropertyDraft('sp1', 'src-a'), sourcePropertyDraft('sp2', 'src-b')] });

  it('shows the source id, abstract and TL;DR', () => {
    const { container } = renderStack(t());
    const c = cards(container)[1]!;
    expect(c.querySelector('.property-update-path')!.textContent).toBe('src-b');
    expect(Array.from(c.querySelectorAll('.source-prop-text')).map((x) => x.textContent))
      .toEqual(['abstract of src-b', 'tldr of src-b']);
  });

  it('omits blocks that are absent', () => {
    const d = { ...sourcePropertyDraft('sp', 's'), abstract: undefined, tldr: undefined };
    const { container } = renderStack(tab({ sourcePropertyDrafts: [d] }));
    expect(container.querySelector('.source-prop-block')).toBeNull();
  });

  it('Approve on the second card applies the second draft', async () => {
    const tt = t();
    const { container } = renderStack(tt);
    await fireEvent.click(approveBtn(cards(container)[1]!));
    expect(h.store.approveSourcePropertyDraft).toHaveBeenCalledWith('tab-7', tt.sourcePropertyDrafts[1]);
  });

  it('Discard on the second card discards the second id', async () => {
    const { container } = renderStack(t());
    await fireEvent.click(discardBtn(cards(container)[1]!));
    expect(h.store.discardSourcePropertyDraft).toHaveBeenCalledWith('tab-7', 'sp2');
  });

  it('logs a failed approval', async () => {
    h.store.approveSourcePropertyDraft.mockRejectedValue(new Error('x'));
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith('approve source property failed:', expect.any(Error)));
  });
});

describe('DraftCards — propose_claims', () => {
  const t = () => tab({ claimsDrafts: [claimsDraft('c1', 'First claim'), claimsDraft('c2', 'Second claim')] });

  it('shows the claim text, kind, confidence and quote', () => {
    const { container } = renderStack(t());
    const c = cards(container)[1]!;
    expect(c.querySelector('.claim-text')!.textContent).toBe('Second claim');
    expect(c.querySelector('.claim-kind')!.textContent).toBe('thesis');
    expect(c.querySelector('.claim-conf')!.textContent).toBe('conf 0.80');
    expect(c.querySelector('.claim-quote')!.textContent).toBe('quote for Second claim');
    expect(c.querySelector('.claim-approx')).toBeNull();
  });

  it('flags an approximate (non-verbatim) quote', () => {
    const d = claimsDraft('c', 'X');
    d.claims[0]!.quoteFound = false;
    const { container } = renderStack(tab({ claimsDrafts: [d] }));
    expect(container.querySelector('.claim-approx')!.textContent).toBe('approx');
  });

  it('Approve on the second card files the second draft', async () => {
    const tt = t();
    const { container } = renderStack(tt);
    await fireEvent.click(approveBtn(cards(container)[1]!));
    expect(h.store.approveClaimsDraft).toHaveBeenCalledWith('tab-7', tt.claimsDrafts[1]);
  });

  it('Discard on the second card discards the second id', async () => {
    const { container } = renderStack(t());
    await fireEvent.click(discardBtn(cards(container)[1]!));
    expect(h.store.discardClaimsDraft).toHaveBeenCalledWith('tab-7', 'c2');
  });

  it('logs a failed approval', async () => {
    h.store.approveClaimsDraft.mockRejectedValue(new Error('x'));
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith('approve claims failed:', expect.any(Error)));
  });
});

// ── the dedicated-card kinds ───────────────────────────────────────────────

describe('DraftCards — refactor (rename/move)', () => {
  const t = () => tab({
    refactorDrafts: [refactorDraft('r1', 'a/one.md', 'a/uno.md'), refactorDraft('r2', 'a/two.md', 'b/two.md')],
  });

  it('dispatches each draft to a refactor card with its own verb and paths', () => {
    const { container } = renderStack(t());
    const [c1, c2] = cards(container);
    expect(c1!.querySelector('.draft-summary strong')!.textContent).toBe('Rename');
    expect(c2!.querySelector('.draft-summary strong')!.textContent).toBe('Move');
    expect(c2!.querySelector('.draft-note')!.textContent).toBe('a/two.md → b/two.md');
  });

  it('Approve on the second card approves the second draft and opens its new path', async () => {
    const tt = t();
    const { container } = renderStack(tt);
    await fireEvent.click(approveBtn(cards(container)[1]!));
    expect(h.store.approveRefactorDraft).toHaveBeenCalledWith('tab-7', tt.refactorDrafts[1]);
    await waitFor(() => expect(h.editor.openFile).toHaveBeenCalledWith('b/two.md'));
  });

  it('a folder move opens no file after approval', async () => {
    const { container } = renderStack(tab({ refactorDrafts: [refactorDraft('rf', 'p/a', 'q/a', 0, true)] }));
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.store.approveRefactorDraft).toHaveBeenCalled());
    expect(h.editor.openFile).not.toHaveBeenCalled();
  });

  it('Discard on the second card discards the second id', async () => {
    const { container } = renderStack(t());
    await fireEvent.click(discardBtn(cards(container)[1]!));
    expect(h.store.discardRefactorDraft).toHaveBeenCalledWith('tab-7', 'r2');
    expect(h.store.approveRefactorDraft).not.toHaveBeenCalled();
  });

  it('logs a failed approval and opens nothing', async () => {
    h.store.approveRefactorDraft.mockRejectedValue(new Error('x'));
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith('approve refactor failed:', expect.any(Error)));
    expect(h.editor.openFile).not.toHaveBeenCalled();
  });
});

describe('DraftCards — reorganization', () => {
  const t = () => tab({
    reorgDrafts: [reorgDraft('ro1', 'x.md', 'd/x.md'), reorgDraft('ro2', 'y.md', 'e/y.md')],
  });

  it('Approve on the second card sends the second draft and its selected pairs, then opens the first moved note', async () => {
    const tt = t();
    const { container } = renderStack(tt);
    await fireEvent.click(approveBtn(cards(container)[1]!));
    expect(h.store.approveReorgDraft).toHaveBeenCalledWith('tab-7', tt.reorgDrafts[1], [{ fromPath: 'y.md', toPath: 'e/y.md' }]);
    await waitFor(() => expect(h.editor.openFile).toHaveBeenCalledWith('e/y.md'));
  });

  it('Discard on the second card discards the second id', async () => {
    const { container } = renderStack(t());
    await fireEvent.click(discardBtn(cards(container)[1]!));
    expect(h.store.discardReorgDraft).toHaveBeenCalledWith('tab-7', 'ro2');
  });

  it('logs a failed approval', async () => {
    h.store.approveReorgDraft.mockRejectedValue(new Error('x'));
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith('approve reorg failed:', expect.any(Error)));
  });
});

describe('DraftCards — delete', () => {
  const t = () => tab({ deleteDrafts: [deleteDraft('d1', 'keep-me.md'), deleteDraft('d2', 'drop-me.md')] });

  it('dispatches to a card labelled Delete showing the target path', () => {
    const { container } = renderStack(t());
    const c = cards(container)[1]!;
    expect(c.querySelector('.draft-summary strong')!.textContent.trim()).toBe('Delete');
    expect(c.textContent).toContain('drop-me.md');
    expect(c.textContent).not.toContain('keep-me.md');
  });

  it('Approve on the second card deletes the SECOND draft\'s paths', async () => {
    const tt = t();
    const { container } = renderStack(tt);
    await fireEvent.click(approveBtn(cards(container)[1]!));
    expect(h.store.approveDeleteDraft).toHaveBeenCalledWith('tab-7', tt.deleteDrafts[1], ['drop-me.md']);
    expect(h.store.approveDeleteDraft).toHaveBeenCalledTimes(1);
  });

  it('Discard on the second card discards the second id and deletes nothing', async () => {
    const { container } = renderStack(t());
    await fireEvent.click(discardBtn(cards(container)[1]!));
    expect(h.store.discardDeleteDraft).toHaveBeenCalledWith('tab-7', 'd2');
    expect(h.store.approveDeleteDraft).not.toHaveBeenCalled();
  });

  it('logs a failed approval', async () => {
    h.store.approveDeleteDraft.mockRejectedValue(new Error('x'));
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith('approve delete failed:', expect.any(Error)));
  });
});

describe('DraftCards — note-body rewrite', () => {
  const t = () => tab({ noteBodyDrafts: [noteBodyDraft('nb1', 'one.md'), noteBodyDraft('nb2', 'two.md')] });

  it('Approve on the second card rewrites the second draft\'s path', async () => {
    const tt = t();
    const { container } = renderStack(tt);
    await fireEvent.click(approveBtn(cards(container)[1]!));
    expect(h.store.approveNoteBodyDraft).toHaveBeenCalledWith('tab-7', tt.noteBodyDrafts[1], ['two.md']);
  });

  it('Discard on the second card discards the second id', async () => {
    const { container } = renderStack(t());
    await fireEvent.click(discardBtn(cards(container)[1]!));
    expect(h.store.discardNoteBodyDraft).toHaveBeenCalledWith('tab-7', 'nb2');
  });

  it('logs a failed approval', async () => {
    h.store.approveNoteBodyDraft.mockRejectedValue(new Error('x'));
    const { container } = renderStack(t());
    await fireEvent.click(approveBtn(cards(container)[0]!));
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith('approve note-body rewrite failed:', expect.any(Error)));
  });
});

describe('DraftCards — compute', () => {
  const t = () => tab({
    computeDrafts: [computeDraft('co1', 'print(1)'), computeDraft('co2', 'print(2)')],
  });

  it('Run on the second card runs the second draft in this tab', async () => {
    const tt = t();
    const { getAllByText } = renderStack(tt);
    await fireEvent.click(getAllByText('Run')[1]!);
    expect(h.store.runComputeDraft).toHaveBeenCalledWith('tab-7', tt.computeDrafts[1], undefined);
  });

  it('Insert on the second card inserts the second draft', async () => {
    const tt = t();
    const { getAllByText } = renderStack(tt);
    await fireEvent.click(getAllByText(/^Insert/)[1]!);
    expect(h.store.insertComputeDraft).toHaveBeenCalledWith('tab-7', tt.computeDrafts[1], undefined);
  });

  it('Discard on the second card discards the second id', async () => {
    const { getAllByText } = renderStack(t());
    await fireEvent.click(getAllByText('Discard')[1]!);
    expect(h.store.discardComputeDraft).toHaveBeenCalledWith('tab-7', 'co2');
  });

  it('opens the inserted note from the card', async () => {
    const tt = tab({
      computeDrafts: [computeDraft('co1', 'print(1)')],
      computeDraftState: { co1: { running: false, result: null, insertedAt: 'notes/inserted.md' } },
    });
    const { container } = renderStack(tt);
    const link = Array.from(container.querySelectorAll('button'))
      .find((b) => /inserted\.md/.test(b.textContent ?? '') || /inserted\.md/.test(b.getAttribute('title') ?? ''));
    expect(link).toBeTruthy();
    await fireEvent.click(link!);
    expect(h.editor.openFile).toHaveBeenCalledWith('notes/inserted.md');
  });
});

// ── post-approval result lines ─────────────────────────────────────────────

describe('DraftCards — result lines', () => {
  it('note results link each filed path by basename and open it', async () => {
    const { getByText } = renderStack(tab({
      noteDraftResults: { n: { filedPaths: ['dir/alpha.md', 'dir/beta.md'], afterMessageIndex: 0 } },
    }));
    await fireEvent.click(getByText('beta.md'));
    expect(h.editor.openFile).toHaveBeenCalledWith('dir/beta.md');
  });

  it('note results with nothing filed say so', () => {
    const { getByText } = renderStack(tab({ noteDraftResults: { n: { filedPaths: [], afterMessageIndex: 0 } } }));
    expect(getByText('(no notes written)')).toBeTruthy();
  });

  it('source results open a filed source, mark duplicates, and show failures', async () => {
    const { getByText, container } = renderStack(tab({
      sourceDraftResults: {
        s: {
          afterMessageIndex: 0,
          outcomes: [
            { input: { identifier: '10.1/a' }, sourceId: 'sid-a', title: 'Paper A' },
            { input: { identifier: '10.1/b' }, sourceId: 'sid-b', duplicate: true },
            { input: { url: 'https://bad' }, error: 'fetch failed' },
            { input: { identifier: 'weird' } },
          ],
        },
      },
    }));
    await fireEvent.click(getByText('Paper A'));
    expect(h.editor.openSource).toHaveBeenCalledWith('sid-a');
    expect(container.textContent).toMatch(/10\.1\/b\s*· already in library/);
    expect(getByText(/⚠ https:\/\/bad/).getAttribute('title')).toBe('fetch failed');
    expect(getByText('weird')).toBeTruthy();
  });

  it('property results distinguish changed, no-op and failed notes', async () => {
    const { container, getByText } = renderStack(tab({
      propertyDraftResults: {
        p: {
          afterMessageIndex: 0,
          outcomes: [
            { relativePath: 'd/a.md', changedKeys: ['x', 'y'], deletedKeys: [] },
            { relativePath: 'd/b.md', changedKeys: [], deletedKeys: [] },
            { relativePath: 'd/c.md', changedKeys: [], deletedKeys: [], error: 'nope' },
          ],
        },
      },
    }));
    const text = container.textContent;
    expect(text).toMatch(/a\.md\s*· 2 keys/);
    expect(text).toMatch(/b\.md\s*· no-op/);
    expect(getByText(/⚠ c\.md/).getAttribute('title')).toBe('nope');
    await fireEvent.click(getByText(/b\.md/));
    expect(h.editor.openFile).toHaveBeenCalledWith('d/b.md');
  });

  it('property results with nothing touched say so', () => {
    const { getByText } = renderStack(tab({ propertyDraftResults: { p: { afterMessageIndex: 0, outcomes: [] } } }));
    expect(getByText('(no notes touched)')).toBeTruthy();
  });

  it('property results use the singular for one changed key', () => {
    const { container } = renderStack(tab({
      propertyDraftResults: { p: { afterMessageIndex: 0, outcomes: [{ relativePath: 'a.md', changedKeys: ['x'], deletedKeys: [] }] } },
    }));
    expect(container.textContent).toMatch(/a\.md\s*· 1 key(?!s)/);
  });

  it.each([
    [{ sourceId: 's1', changedPredicates: ['dc:abstract', 'thought:tldr'] }, 's1 · dc:abstract, thought:tldr'],
    [{ sourceId: 's1', changedPredicates: [] }, 's1 · no change'],
    [{ sourceId: 's1', changedPredicates: [], error: 'bad' }, '⚠ s1'],
  ])('source-property result %#', (outcome, expected) => {
    const { container } = renderStack(tab({
      sourcePropertyDraftResults: { sp: { afterMessageIndex: 0, outcome } },
    }));
    expect(container.textContent).toContain(expected);
  });

  it('claims results link each claim note and count excerpts', async () => {
    const { container, getByText } = renderStack(tab({
      claimsDraftResults: {
        c: { afterMessageIndex: 0, outcome: { sourceId: 's', claimPaths: ['claims/one.md', 'claims/two.md'], excerptIds: ['e1'] } },
      },
    }));
    expect(container.textContent).toContain('· 1 excerpt');
    expect(container.textContent).not.toContain('1 excerpts');
    await fireEvent.click(getByText('two.md'));
    expect(h.editor.openFile).toHaveBeenCalledWith('claims/two.md');
  });

  it('claims results pluralise excerpts', () => {
    const { container } = renderStack(tab({
      claimsDraftResults: {
        c: { afterMessageIndex: 0, outcome: { sourceId: 's', claimPaths: ['a.md'], excerptIds: ['e1', 'e2'] } },
      },
    }));
    expect(container.textContent).toContain('· 2 excerpts');
  });

  it('claims results show a failure', () => {
    const { container } = renderStack(tab({
      claimsDraftResults: {
        c: { afterMessageIndex: 0, outcome: { sourceId: 'src-x', claimPaths: [], excerptIds: [], error: 'bad' } },
      },
    }));
    expect(container.textContent).toContain('⚠ src-x');
  });
});
