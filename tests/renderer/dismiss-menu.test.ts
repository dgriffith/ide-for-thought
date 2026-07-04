/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installDismissOnClickOutside } from '../../src/renderer/lib/dismiss-menu';

describe('installDismissOnClickOutside (#989)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('does not dismiss on the click that opened the menu (deferred registration)', () => {
    const onDismiss = vi.fn();
    installDismissOnClickOutside(onDismiss);
    // Same tick: listener isn't armed yet.
    window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses on the next outside click and removes its listener', () => {
    const onDismiss = vi.fn();
    installDismissOnClickOutside(onDismiss);
    vi.advanceTimersByTime(0);

    window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // Listener removed itself — a second click does nothing.
    window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks inside ignoreSelector and stays armed', () => {
    const inner = document.createElement('button');
    inner.className = 'inside';
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.appendChild(inner);
    document.body.appendChild(menu);

    const onDismiss = vi.fn();
    installDismissOnClickOutside(onDismiss, '.menu');
    vi.advanceTimersByTime(0);

    // Click inside the menu: ignored, listener still armed.
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    // Click outside (on a real element, as a real bubbled click would be): dismisses.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
