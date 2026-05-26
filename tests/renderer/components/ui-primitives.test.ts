/**
 * @vitest-environment happy-dom
 *
 * Smoke coverage for the UI primitives introduced for the 2026-05
 * design review (#545). The components have no app callers yet —
 * they'll be consumed by the dialogs sweep (#552) — so these tests
 * just lock in the contract: render, fire callbacks, reflect bindings.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

import Toggle from '../../../src/renderer/lib/components/ui/Toggle.svelte';
import Stepper from '../../../src/renderer/lib/components/ui/Stepper.svelte';
import SegmentedControl from '../../../src/renderer/lib/components/ui/SegmentedControl.svelte';

afterEach(cleanup);

describe('Toggle', () => {
  it('renders the on state and flips on click', async () => {
    let value = false;
    const { container, rerender } = render(Toggle, {
      props: {
        checked: value,
        onchange: (next) => { value = next; },
        'aria-label': 'enable',
      },
    });
    const btn = container.querySelector('button[role="switch"]')!;
    expect(btn.getAttribute('aria-checked')).toBe('false');

    await fireEvent.click(btn);
    expect(value).toBe(true);

    // Re-render with the latest value to confirm the visual state tracks
    await rerender({
      checked: value,
      onchange: (next: boolean) => { value = next; },
      'aria-label': 'enable',
    });
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('does not flip when disabled', async () => {
    let value = false;
    const { container } = render(Toggle, {
      props: { checked: value, disabled: true, onchange: (n) => { value = n; } },
    });
    await fireEvent.click(container.querySelector('button[role="switch"]')!);
    expect(value).toBe(false);
  });
});

describe('Stepper', () => {
  it('bumps the value by step, clamped to min/max', async () => {
    let value = 5;
    const { container } = render(Stepper, {
      props: { value, step: 2, min: 0, max: 10, onchange: (n) => { value = n; } },
    });
    const [minus, plus] = Array.from(container.querySelectorAll('button.step-btn'));
    await fireEvent.click(plus); // 5 → 7
    expect(value).toBe(7);
    await fireEvent.click(plus); // 7 → 9
    await fireEvent.click(plus); // 9 → 10 (clamped)
    expect(value).toBe(10);
    await fireEvent.click(minus); // 10 → 8
    expect(value).toBe(8);
  });

  it('honours unit and precision in display', () => {
    const { container } = render(Stepper, {
      props: { value: 1.55, step: 0.05, unit: '×' },
    });
    expect(container.querySelector('.value')!.textContent).toBe('1.55×');
  });
});

describe('SegmentedControl', () => {
  it('selects the clicked option and fires onchange', async () => {
    let value: string = 'a';
    const { container } = render(SegmentedControl, {
      props: {
        value,
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', sub: '23' },
          { value: 'c', label: 'C' },
        ],
        onchange: (next) => { value = next; },
      },
    });
    const segments = Array.from(container.querySelectorAll('button.segment'));
    expect(segments[0].classList.contains('active')).toBe(true);

    await fireEvent.click(segments[1]);
    expect(value).toBe('b');
  });
});
