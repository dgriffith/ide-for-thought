/**
 * ⌘⇧H toggle/cycle command (#468). The pure `computeToggleHighlight`
 * function takes (lineText, lineFrom, selFrom, selTo) and returns the
 * dispatch shape — easy to test without standing up a CodeMirror view.
 */

import { describe, it, expect } from 'vitest';
import { computeToggleHighlight } from '../../../src/renderer/lib/editor/formatting';

/** Helper: line offset 0 is the common case. */
function toggle(line: string, selFrom: number, selTo: number) {
  return computeToggleHighlight(line, 0, selFrom, selTo);
}

/** Apply a result back onto the line so the next cycle step can chain. */
function apply(line: string, r: NonNullable<ReturnType<typeof toggle>>) {
  return {
    text: line.slice(0, r.from) + r.insert + line.slice(r.to),
    selFrom: r.selFrom,
    selTo: r.selTo,
  };
}

describe('computeToggleHighlight — wrap on first press', () => {
  it('wraps a selection with ==yellow:body== and reselects the body', () => {
    const r = toggle('Hello world', 6, 11);
    expect(r).not.toBeNull();
    expect(r!.from).toBe(6);
    expect(r!.to).toBe(11);
    expect(r!.insert).toBe('==yellow:world==');
    // Body inside the new markers: starts after `==yellow:` (offset 9 within the insert).
    expect(r!.selFrom).toBe(6 + '==yellow:'.length);
    expect(r!.selTo).toBe(6 + '==yellow:'.length + 'world'.length);
  });

  it('handles empty selection by inserting an empty colored span', () => {
    const r = toggle('Hello |', 5, 5);
    expect(r).not.toBeNull();
    expect(r!.insert).toBe('==yellow:==');
    // Selection collapses to the empty body — cursor between `:` and `==`.
    expect(r!.selFrom).toBe(5 + '==yellow:'.length);
    expect(r!.selTo).toBe(5 + '==yellow:'.length);
  });
});

describe('computeToggleHighlight — cycle on repeat press', () => {
  it('advances yellow → green', () => {
    const r = toggle('==yellow:warn==', 9, 13);
    expect(r!.insert).toBe('==green:warn==');
    expect(r!.selFrom).toBe('==green:'.length);
    expect(r!.selTo).toBe('==green:'.length + 'warn'.length);
  });

  it.each([
    ['yellow', 'green'],
    ['green', 'blue'],
    ['blue', 'pink'],
    ['pink', 'orange'],
  ])('advances %s → %s', (from, to) => {
    const line = `==${from}:hi==`;
    const innerStart = `==${from}:`.length;
    const r = toggle(line, innerStart, innerStart + 2);
    expect(r!.insert).toBe(`==${to}:hi==`);
  });

  it('unwraps when cycling past orange', () => {
    const r = toggle('==orange:done==', 9, 13);
    expect(r!.insert).toBe('done');
    expect(r!.from).toBe(0);
    expect(r!.to).toBe('==orange:done=='.length);
    // Body reselected on the now-plain text.
    expect(r!.selFrom).toBe(0);
    expect(r!.selTo).toBe('done'.length);
  });

  it('unwraps an uncolored ==text== rather than promoting it to yellow', () => {
    // The user explicitly typed the uncolored form; the shortcut
    // should respect that intent and remove the highlight rather
    // than silently changing it to yellow.
    const r = toggle('==plain==', 2, 7);
    expect(r!.insert).toBe('plain');
  });

  it('full round-trip: wrap → cycle → unwrap returns to plain text', () => {
    let state = { text: 'Hello body', selFrom: 6, selTo: 10 };
    const expected = [
      '==yellow:body==',
      '==green:body==',
      '==blue:body==',
      '==pink:body==',
      '==orange:body==',
      'body', // unwrap
    ];
    for (const want of expected) {
      const r = computeToggleHighlight(state.text, 0, state.selFrom, state.selTo);
      expect(r).not.toBeNull();
      const applied = apply(state.text, r!);
      expect(applied.text.slice(6, 6 + want.length) === want
        || applied.text === 'Hello body').toBe(true);
      state = applied;
    }
    // After unwrap we should be back at the original text.
    expect(state.text).toBe('Hello body');
    // And the selection still covers "body" so the next press re-wraps.
    expect(state.selFrom).toBe(6);
    expect(state.selTo).toBe(10);
  });
});

describe('computeToggleHighlight — selection placement edge cases', () => {
  it('detects containment when cursor is at the start of the body', () => {
    const r = toggle('==yellow:warn==', 9, 9);
    expect(r!.insert).toBe('==green:warn==');
  });

  it('detects containment when cursor is at the end (right before closing `==`)', () => {
    const r = toggle('==yellow:warn==', 13, 13);
    expect(r!.insert).toBe('==green:warn==');
  });

  it('detects containment when selection covers the whole span including markers', () => {
    const r = toggle('==yellow:warn==', 0, 15);
    expect(r!.insert).toBe('==green:warn==');
  });

  it('treats a selection adjacent to (not inside) a highlight as wrap', () => {
    // Selection is the leading "Hi " before the highlight.
    const r = toggle('Hi ==yellow:warn==', 0, 3);
    // We wrap whatever the user selected.
    expect(r!.insert).toBe('==yellow:Hi ==');
  });
});

describe('computeToggleHighlight — line + offset handling', () => {
  it('honours a non-zero lineFrom for selections deep in the document', () => {
    // Pretend the line starts at offset 1000.
    const r = computeToggleHighlight('A==yellow:b==', 1000, 1003, 1004);
    expect(r).not.toBeNull();
    // Detected as containment; cycles to green; absolute offsets preserved.
    expect(r!.from).toBe(1001);
    expect(r!.to).toBe(1013);
    expect(r!.insert).toBe('==green:b==');
  });
});
