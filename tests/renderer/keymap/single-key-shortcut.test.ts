/**
 * @vitest-environment happy-dom
 *
 * `isBareKeyShortcut` (#2377) — the guard that keeps a panel's single-letter
 * shortcuts (WCAG 2.1.4) from firing while the user types, or when the letter
 * is part of a modified app shortcut.
 */
import { describe, it, expect } from 'vitest';
import { isBareKeyShortcut } from '../../../src/renderer/lib/keymap/single-key-shortcut';

function keydownOn(target: HTMLElement, init: KeyboardEventInit = {}): KeyboardEvent {
  let seen: KeyboardEvent | null = null;
  document.body.appendChild(target);
  target.addEventListener('keydown', (e) => { seen = e; }, { once: true });
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true, ...init }));
  target.remove();
  return seen!;
}

describe('isBareKeyShortcut (#2377)', () => {
  it('fires for an unmodified key on a button', () => {
    expect(isBareKeyShortcut(keydownOn(document.createElement('button')))).toBe(true);
  });

  it.each(['input', 'textarea', 'select'])('does not fire while typing in <%s>', (tag) => {
    expect(isBareKeyShortcut(keydownOn(document.createElement(tag)))).toBe(false);
  });

  it('does not fire in a contenteditable (e.g. CodeMirror)', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    expect(isBareKeyShortcut(keydownOn(div))).toBe(false);
  });

  it.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['altKey', { altKey: true }],
  ] as const)('does not fire with %s held', (_name, mods) => {
    expect(isBareKeyShortcut(keydownOn(document.createElement('button'), mods))).toBe(false);
  });
});
