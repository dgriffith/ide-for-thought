/**
 * @vitest-environment happy-dom
 *
 * Smoke coverage for the UI primitives introduced for the 2026-05 design
 * review (#545) and adopted at real call sites in #1889 (Toggle in
 * ComputeSettings, SegmentedControl in OnboardingDialog + FindInNotesDialog).
 * These tests lock in the contract: render, fire callbacks, reflect bindings.
 *
 * Stepper.svelte was deleted in #1889 — it never found a real call site (its
 * fixed linear step model didn't fit PdfViewer's zoom, the one plausible
 * candidate, which uses a curated non-linear scale table).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

import Toggle from '../../../src/renderer/lib/components/ui/Toggle.svelte';
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
