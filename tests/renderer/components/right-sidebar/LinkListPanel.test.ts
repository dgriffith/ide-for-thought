/**
 * @vitest-environment happy-dom
 *
 * `LinkListPanel` (#1909 — merged from the former `BacklinksPanel` /
 * `OutgoingLinksPanel`). One component, direction-parameterised; this file
 * exercises both directions against the same test bodies where the behavior
 * is shared, plus the two genuinely direction-specific behaviors that don't
 * unify: outgoing links can be "dead" (unresolved target — a warn icon, rust
 * title, no-op click), and only backlinks are a drag-to-insert source.
 *
 * `getLinkBundle` (the coalesced fetch) is mocked so each test controls
 * exactly what bundle resolves; nothing here touches real IPC.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { OutgoingLink, Backlink } from '../../../../src/shared/types';

const h = vi.hoisted(() => ({
  getLinkBundle: vi.fn(),
  linkDragStart: vi.fn(),
}));

vi.mock('../../../../src/renderer/lib/sidebar-link-bundle', () => ({
  getLinkBundle: h.getLinkBundle,
}));
vi.mock('../../../../src/renderer/lib/stores/link-drag.svelte', () => ({
  getLinkDrag: () => ({ start: h.linkDragStart }),
}));
vi.mock('../../../../src/renderer/lib/stores/object-types.svelte', () => ({
  objectTypesStore: { typeForNote: () => null },
}));

import LinkListPanel from '../../../../src/renderer/lib/components/right-sidebar/LinkListPanel.svelte';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function backlink(over: Partial<Backlink> = {}): Backlink {
  return {
    source: 'notes/a.md',
    sourceTitle: 'Note A',
    linkType: 'references',
    linkLabel: 'References',
    linkColor: '#fff',
    ...over,
  };
}

function outgoing(over: Partial<OutgoingLink> = {}): OutgoingLink {
  return {
    target: 'notes/b.md',
    targetTitle: 'Note B',
    linkType: 'references',
    linkLabel: 'References',
    linkColor: '#fff',
    exists: true,
    ...over,
  };
}

const baseProps = (direction: 'backlinks' | 'outgoing') => ({
  direction,
  activeFilePath: 'notes/active.md',
  revision: 1,
  onFileSelect: vi.fn(),
});

describe('LinkListPanel — backlinks direction (#1909)', () => {
  it('fetches the bundle and renders backlinks by source/sourceTitle', async () => {
    h.getLinkBundle.mockResolvedValue({ backlinks: [backlink()], outgoing: [] });
    const { findByText, getByPlaceholderText } = render(LinkListPanel, baseProps('backlinks'));

    await findByText('Note A');
    expect(getByPlaceholderText('Find mention…')).toBeTruthy();
    expect(h.getLinkBundle).toHaveBeenCalledWith('notes/active.md', 1);
  });

  it('shows the backlinks-specific empty message when there are none', async () => {
    h.getLinkBundle.mockResolvedValue({ backlinks: [], outgoing: [] });
    const { findByText } = render(LinkListPanel, baseProps('backlinks'));
    await findByText('No backlinks found');
  });

  it('clicking a backlink calls onFileSelect with its source path', async () => {
    h.getLinkBundle.mockResolvedValue({ backlinks: [backlink({ source: 'notes/a.md' })], outgoing: [] });
    const onFileSelect = vi.fn();
    const { findByText } = render(LinkListPanel, { ...baseProps('backlinks'), onFileSelect });

    const item = await findByText('Note A');
    await fireEvent.click(item);
    expect(onFileSelect).toHaveBeenCalledWith('notes/a.md');
  });

  it('is a drag-to-insert source', async () => {
    h.getLinkBundle.mockResolvedValue({ backlinks: [backlink()], outgoing: [] });
    const { findByText } = render(LinkListPanel, baseProps('backlinks'));

    const item = await findByText('Note A');
    await fireEvent.pointerDown(item);
    expect(h.linkDragStart).toHaveBeenCalledWith(
      { kind: 'note', path: 'notes/a.md', label: 'Note A' },
      expect.anything(),
    );
  });
});

describe('LinkListPanel — outgoing direction (#1909)', () => {
  it('fetches the bundle and renders outgoing links by target/targetTitle', async () => {
    h.getLinkBundle.mockResolvedValue({ backlinks: [], outgoing: [outgoing()] });
    const { findByText, getByPlaceholderText } = render(LinkListPanel, baseProps('outgoing'));

    await findByText('Note B');
    expect(getByPlaceholderText('Find link…')).toBeTruthy();
  });

  it('shows the outgoing-specific empty message when there are none', async () => {
    h.getLinkBundle.mockResolvedValue({ backlinks: [], outgoing: [] });
    const { findByText } = render(LinkListPanel, baseProps('outgoing'));
    await findByText('No outgoing links');
  });

  it('clicking a live outgoing link calls onFileSelect', async () => {
    h.getLinkBundle.mockResolvedValue({ backlinks: [], outgoing: [outgoing({ target: 'notes/b.md', exists: true })] });
    const onFileSelect = vi.fn();
    const { findByText } = render(LinkListPanel, { ...baseProps('outgoing'), onFileSelect });

    const item = await findByText('Note B');
    await fireEvent.click(item);
    expect(onFileSelect).toHaveBeenCalledWith('notes/b.md');
  });

  it('a dead (unresolved) outgoing link is styled distinctly and does not navigate', async () => {
    h.getLinkBundle.mockResolvedValue({ backlinks: [], outgoing: [outgoing({ target: 'notes/ghost.md', targetTitle: 'Ghost', exists: false })] });
    const onFileSelect = vi.fn();
    const { findByText } = render(LinkListPanel, { ...baseProps('outgoing'), onFileSelect });

    const item = await findByText('Ghost');
    const button = item.closest('button')!;
    expect(button.className).toContain('dead');
    await fireEvent.click(button);
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('is NOT a drag-to-insert source — outgoing links are already a reference FROM this note', async () => {
    h.getLinkBundle.mockResolvedValue({ backlinks: [], outgoing: [outgoing()] });
    const { findByText } = render(LinkListPanel, baseProps('outgoing'));

    const item = await findByText('Note B');
    await fireEvent.pointerDown(item);
    expect(h.linkDragStart).not.toHaveBeenCalled();
  });
});

describe('LinkListPanel — search filtering, either direction', () => {
  it('filters backlinks by title', async () => {
    h.getLinkBundle.mockResolvedValue({
      backlinks: [backlink({ source: 'notes/a.md', sourceTitle: 'Alpha' }), backlink({ source: 'notes/z.md', sourceTitle: 'Zeta' })],
      outgoing: [],
    });
    const { findByText, queryByText, getByPlaceholderText } = render(LinkListPanel, baseProps('backlinks'));
    await findByText('Alpha');

    await fireEvent.input(getByPlaceholderText('Find mention…'), { target: { value: 'zet' } });

    await waitFor(() => expect(queryByText('Alpha')).toBeNull());
    expect(queryByText('Zeta')).toBeTruthy();
  });
});
