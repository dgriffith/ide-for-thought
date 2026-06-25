/**
 * @vitest-environment happy-dom
 *
 * Keyboard + ARIA coverage for the split divider (#817 a11y). The pointer-drag
 * path is exercised by `split-resize.test.ts` (the pure math); here we pin that
 * a focused divider is operable from the keyboard and exposes the right roles —
 * arrow keys nudge the boundary by a fixed step, mapped to the split axis.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import ResizeHandle from '../../../src/renderer/lib/components/ResizeHandle.svelte';

afterEach(cleanup);

const STEP = 24;

function renderHandle(direction: 'horizontal' | 'vertical') {
  const onResize = vi.fn();
  const onResizeEnd = vi.fn();
  const { getByRole } = render(ResizeHandle, { direction, onResize, onResizeEnd });
  return { handle: getByRole('separator'), onResize, onResizeEnd };
}

describe('ResizeHandle a11y (#817)', () => {
  it('exposes a focusable separator with orientation and a label', () => {
    const { handle } = renderHandle('horizontal');
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('tabindex')).toBe('0');
    // A horizontal split (panes left↔right) is a vertically-oriented divider.
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-label')).toBeTruthy();
  });

  it('horizontal divider: Right grows the leading pane, Left shrinks it', async () => {
    const { handle, onResize, onResizeEnd } = renderHandle('horizontal');
    await fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenLastCalledWith(STEP);
    await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenLastCalledWith(-STEP);
    expect(onResizeEnd).toHaveBeenCalledTimes(2); // persists after each nudge
  });

  it('vertical divider: Down grows the leading pane, Up shrinks it', async () => {
    const { handle, onResize } = renderHandle('vertical');
    await fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onResize).toHaveBeenLastCalledWith(STEP);
    await fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(onResize).toHaveBeenLastCalledWith(-STEP);
  });

  it('ignores the cross-axis arrows and other keys', async () => {
    const { handle, onResize } = renderHandle('horizontal');
    await fireEvent.keyDown(handle, { key: 'ArrowUp' });
    await fireEvent.keyDown(handle, { key: 'ArrowDown' });
    await fireEvent.keyDown(handle, { key: 'Enter' });
    expect(onResize).not.toHaveBeenCalled();
  });
});
