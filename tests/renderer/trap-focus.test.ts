/**
 * @vitest-environment happy-dom
 *
 * Unit coverage for the `trapFocus` modal focus-trap action (#1104). Exercises
 * the boundary/mount/destroy behaviour the action drives itself (explicit
 * `.focus()` calls) — the parts that don't depend on the browser's native Tab
 * traversal. Intermediate native Tab moves are covered by the real-browser
 * e2e test (tests/e2e/focus-trap.spec.ts).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { trapFocus } from '../../src/renderer/lib/trap-focus';

function build(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

function pressTab(node: HTMLElement, shift = false): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  node.dispatchEvent(ev);
  return ev;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('trapFocus', () => {
  it('pulls focus into the dialog on mount when nothing inside is focused', () => {
    const dialog = build('<div><button id="a">A</button><button id="b">B</button></div>');
    const handle = trapFocus(dialog);
    expect(document.activeElement?.id).toBe('a');
    handle.destroy();
  });

  it('wraps Tab from the last control back to the first', () => {
    const dialog = build('<div><button id="a">A</button><button id="b">B</button></div>');
    const handle = trapFocus(dialog);
    document.getElementById('b')!.focus();
    const ev = pressTab(dialog);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
    handle.destroy();
  });

  it('wraps Shift+Tab from the first control back to the last', () => {
    const dialog = build('<div><button id="a">A</button><button id="b">B</button></div>');
    const handle = trapFocus(dialog);
    document.getElementById('a')!.focus();
    const ev = pressTab(dialog, true);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('b');
    handle.destroy();
  });

  it('pulls stray focus back in when Tab fires with focus outside the dialog', () => {
    document.body.innerHTML = '<button id="outside">out</button><div id="d"><button id="a">A</button></div>';
    const dialog = document.getElementById('d')!;
    document.getElementById('outside')!.focus();
    const handle = trapFocus(dialog);
    document.getElementById('outside')!.focus(); // escape behind the modal
    pressTab(dialog);
    expect(document.activeElement?.id).toBe('a');
    handle.destroy();
  });

  it('does not let Tab leak out of a dialog with no focusable content', () => {
    const dialog = build('<div><span>no controls</span></div>');
    const handle = trapFocus(dialog);
    const ev = pressTab(dialog);
    expect(ev.defaultPrevented).toBe(true);
    handle.destroy();
  });

  it('ignores disabled and tabindex="-1" controls when finding the ends', () => {
    const dialog = build(
      '<div><button id="a">A</button><button disabled>x</button>' +
      '<button id="skip" tabindex="-1">y</button><button id="z">Z</button></div>',
    );
    const handle = trapFocus(dialog);
    document.getElementById('z')!.focus(); // last *tabbable* → wraps to a
    pressTab(dialog);
    expect(document.activeElement?.id).toBe('a');
    handle.destroy();
  });

  it('does NOT intercept an intermediate Tab (lets the browser advance natively)', () => {
    const dialog = build('<div><button id="a">A</button><button id="b">B</button><button id="c">C</button></div>');
    const handle = trapFocus(dialog);
    document.getElementById('a')!.focus(); // not the last control
    const ev = pressTab(dialog);
    expect(ev.defaultPrevented).toBe(false);
    handle.destroy();
  });

  it('restores focus to the previously-focused element on destroy', () => {
    document.body.innerHTML = '<button id="trigger">open</button><div id="d"><button id="a">A</button></div>';
    document.getElementById('trigger')!.focus();
    const handle = trapFocus(document.getElementById('d')!);
    expect(document.activeElement?.id).toBe('a'); // focus moved in
    handle.destroy();
    expect(document.activeElement?.id).toBe('trigger'); // …and back out
  });
});
