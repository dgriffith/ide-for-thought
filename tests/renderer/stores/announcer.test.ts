/**
 * @vitest-environment happy-dom
 *
 * The app-level screen-reader announcer (#2374): the store, the always-mounted
 * `LiveAnnouncer` regions it feeds, and the two stores that route through it
 * (toasts, busy) because their own markup is rendered conditionally and so
 * can't be a reliable live region.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import {
  announce, condenseForAnnouncement, getAnnouncerStore, MAX_ANNOUNCEMENT_CHARS,
} from '../../../src/renderer/lib/stores/announcer.svelte';
import { getToastStore } from '../../../src/renderer/lib/stores/toasts.svelte';
import { getBusyStore } from '../../../src/renderer/lib/stores/busy.svelte';
import LiveAnnouncer from '../../../src/renderer/lib/components/LiveAnnouncer.svelte';

const store = getAnnouncerStore();
const clean = (s: string) => s.replace(/\u00A0$/, '');

afterEach(() => cleanup());

describe('announcer store', () => {
  it('routes polite and assertive messages to separate regions', () => {
    announce('Indexing finished');
    announce('Turn failed', 'assertive');
    expect(clean(store.polite)).toBe('Indexing finished');
    expect(clean(store.assertive)).toBe('Turn failed');
  });

  it('makes a repeat of the same text a real change, so it is spoken again', () => {
    announce('1 new proposal');
    const first = store.polite;
    announce('1 new proposal');
    expect(store.polite).not.toBe(first);
    expect(clean(store.polite)).toBe('1 new proposal');
    announce('1 new proposal');
    expect(store.polite).toBe(first);
  });

  it('ignores blank messages', () => {
    announce('something');
    const before = store.polite;
    announce('   \n ');
    expect(store.polite).toBe(before);
  });

  it('condenses whitespace and truncates long text at a word boundary', () => {
    expect(condenseForAnnouncement('a\n\n  b\tc')).toBe('a b c');
    const out = condenseForAnnouncement('word '.repeat(200));
    expect(out.length).toBeLessThanOrEqual(MAX_ANNOUNCEMENT_CHARS + 1);
    expect(out.endsWith('word…')).toBe(true);
  });
});

describe('LiveAnnouncer', () => {
  it('renders both regions up front, then swaps their text in place', () => {
    const { getByRole } = render(LiveAnnouncer);
    const status = getByRole('status');
    const alert = getByRole('alert');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.classList.contains('visually-hidden')).toBe(true);

    announce('Response complete. Hello.');
    flushSync();
    // Same node, new text — the precondition for the change to be spoken.
    expect(getByRole('status')).toBe(status);
    expect(clean(status.textContent ?? '')).toBe('Response complete. Hello.');

    announce('Response failed. Overloaded.', 'assertive');
    flushSync();
    expect(clean(alert.textContent ?? '')).toBe('Response failed. Overloaded.');
  });
});

describe('stores that speak through the announcer', () => {
  it('every toast is announced', () => {
    const toasts = getToastStore();
    const id = toasts.push({ message: '3 new proposals from Claude', durationMs: 0 });
    expect(clean(store.polite)).toBe('3 new proposals from Claude');
    toasts.dismiss(id);
  });

  it('busy speaks when it goes busy, not on each label update', () => {
    const busy = getBusyStore();
    announce('sentinel');
    busy.setLabel('Rebuilding indexes 0/10…');
    expect(clean(store.polite)).toBe('Rebuilding indexes 0/10…');
    announce('sentinel');
    for (let i = 1; i <= 10; i++) busy.setLabel(`Rebuilding indexes ${i}/10…`);
    expect(clean(store.polite)).toBe('sentinel');
    busy.setLabel(null);
    busy.setLabel('Importing…');
    expect(clean(store.polite)).toBe('Importing…');
    busy.setLabel(null);
  });

  it('withBusy announces its label', async () => {
    const busy = getBusyStore();
    await busy.withBusy('Fetching…', async () => {
      expect(clean(store.polite)).toBe('Fetching…');
    });
    expect(busy.label).toBeNull();
  });
});
