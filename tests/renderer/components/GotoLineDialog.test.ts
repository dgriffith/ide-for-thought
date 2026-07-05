/**
 * @vitest-environment happy-dom
 *
 * Render + rune-reactivity coverage for GotoLineDialog (#1002).
 *
 * Drives the real dialog the way a user does: type a target into the bound
 * input, then press Enter (or Escape / click the backdrop). The `value` rune is
 * two-way bound to the input; the parse ("line" or "line:col") runs in the
 * keydown handler, so these tests assert the reactively-bound value is parsed
 * and dispatched through onGoto with the correct line/column, and that the
 * empty / non-numeric guards suppress the callback.
 *
 * NOTE: there is no submit button and no clamping to a max line — the handler
 * trusts whatever integer the user typed. Tests pin that actual behavior.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import GotoLineDialog from '../../../src/renderer/lib/components/GotoLineDialog.svelte';

afterEach(cleanup);

function renderDialog(over: {
  currentLine?: number;
  currentColumn?: number;
  onGoto?: (line: number, column: number) => void;
  onCancel?: () => void;
} = {}) {
  const onGoto = over.onGoto ?? vi.fn();
  const onCancel = over.onCancel ?? vi.fn();
  const r = render(GotoLineDialog, {
    currentLine: over.currentLine ?? 12,
    currentColumn: over.currentColumn ?? 3,
    onGoto,
    onCancel,
  });
  const input = r.container.querySelector('input.input') as HTMLInputElement;
  return { ...r, input, onGoto, onCancel };
}

/** Type into the bound input, then press Enter — mirrors a real "go to line". */
async function typeAndEnter(input: HTMLInputElement, text: string) {
  await fireEvent.input(input, { target: { value: text } });
  await fireEvent.keyDown(input, { key: 'Enter' });
}

describe('GotoLineDialog (#1002)', () => {
  it('seeds the placeholder from the current line:column props', () => {
    const { input } = renderDialog({ currentLine: 12, currentColumn: 3 });
    expect(input.placeholder).toBe('12:3');
  });

  it('Enter parses a bare line number and fires onGoto with column 1', async () => {
    const { input, onGoto } = renderDialog();
    await typeAndEnter(input, '42');
    expect(onGoto).toHaveBeenCalledTimes(1);
    expect(onGoto).toHaveBeenCalledWith(42, 1);
  });

  it('Enter splits "line:col" and fires onGoto with both parsed values', async () => {
    const { input, onGoto } = renderDialog();
    await typeAndEnter(input, '42:7');
    expect(onGoto).toHaveBeenCalledWith(42, 7);
  });

  it('a non-numeric column falls back to column 1 while keeping the line', async () => {
    const { input, onGoto } = renderDialog();
    await typeAndEnter(input, '42:abc');
    expect(onGoto).toHaveBeenCalledWith(42, 1);
  });

  it('empty / non-numeric input does not fire onGoto', async () => {
    const { input, onGoto } = renderDialog();

    await fireEvent.keyDown(input, { key: 'Enter' }); // empty value → guarded out
    await typeAndEnter(input, '   ');                 // whitespace → trim() falsy
    await typeAndEnter(input, 'abc');                 // NaN line → rejected

    expect(onGoto).not.toHaveBeenCalled();
  });

  it('Escape fires onCancel without dispatching a goto', async () => {
    const { input, onGoto, onCancel } = renderDialog();
    await fireEvent.input(input, { target: { value: '42' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onGoto).not.toHaveBeenCalled();
  });

  it('clicking the backdrop (not the dialog) cancels', async () => {
    const { container, onCancel } = renderDialog();
    const overlay = container.querySelector('.overlay') as HTMLElement;
    await fireEvent.mouseDown(overlay);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
