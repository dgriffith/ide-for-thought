/**
 * @vitest-environment happy-dom
 *
 * Tab context-menu coverage for the close/move items (#870). Pins the
 * group-aware conditionals: "Close All In Group" and the move targets only
 * appear when there's more than one group, and the move surface is a single
 * item for one other group vs a submenu for several.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import TabBar from '../../../src/renderer/lib/components/TabBar.svelte';

afterEach(cleanup);

const tabs = [
  { type: 'note', relativePath: 'a.md', fileName: 'a.md', content: '', savedContent: '' },
  { type: 'note', relativePath: 'b.md', fileName: 'b.md', content: '', savedContent: '' },
];

function renderBar(over: {
  otherGroups?: { id: string; label: string }[];
  onCloseAll?: () => void;
  onCloseAllInGroup?: () => void;
  onMoveToGroup?: (index: number, targetGroupId: string) => void;
} = {}) {
  const props = {
    tabs,
    activeIndex: 0,
    onSwitch: vi.fn(),
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseAll: over.onCloseAll ?? vi.fn(),
    onReveal: vi.fn(),
    onCloseAllInGroup: over.onCloseAllInGroup,
    otherGroups: over.otherGroups,
    onMoveToGroup: over.onMoveToGroup,
  };
  const r = render(TabBar, props);
  return r;
}

/** Right-click the first tab to open the context menu. */
async function openMenu(container: HTMLElement) {
  await fireEvent.contextMenu(container.querySelector('.tab') as HTMLElement);
}

describe('TabBar context menu — close/move (#870)', () => {
  it('single group: no "Close All In Group" or move items', async () => {
    const { container, queryByText } = renderBar({ otherGroups: [] });
    await openMenu(container);
    expect(queryByText('Close All')).toBeTruthy();
    expect(queryByText('Close All In Group')).toBeNull();
    expect(queryByText('Move to Other Group')).toBeNull();
    expect(queryByText('Move to Group')).toBeNull();
  });

  it('two groups: "Close All In Group" + a single "Move to Other Group"', async () => {
    const onCloseAllInGroup = vi.fn();
    const onMoveToGroup = vi.fn();
    const { container, getByText, queryByText } = renderBar({
      otherGroups: [{ id: 'g2', label: 'Group 2' }],
      onCloseAllInGroup,
      onMoveToGroup,
    });
    await openMenu(container);
    expect(queryByText('Close All In Group')).toBeTruthy();
    expect(queryByText('Move to Group')).toBeNull(); // no submenu for one target

    await fireEvent.click(getByText('Close All In Group'));
    expect(onCloseAllInGroup).toHaveBeenCalledOnce();

    await openMenu(container);
    await fireEvent.click(getByText('Move to Other Group'));
    expect(onMoveToGroup).toHaveBeenCalledWith(0, 'g2');
  });

  it('three+ groups: a "Move to Group" submenu listing each target', async () => {
    const onMoveToGroup = vi.fn();
    const { container, getByText, queryByText } = renderBar({
      otherGroups: [{ id: 'g1', label: 'Group 1' }, { id: 'g3', label: 'Group 3' }],
      onCloseAllInGroup: vi.fn(),
      onMoveToGroup,
    });
    await openMenu(container);
    expect(queryByText('Move to Group')).toBeTruthy();
    expect(queryByText('Move to Other Group')).toBeNull();

    await fireEvent.click(getByText('Group 3'));
    expect(onMoveToGroup).toHaveBeenCalledWith(0, 'g3');
  });
});
