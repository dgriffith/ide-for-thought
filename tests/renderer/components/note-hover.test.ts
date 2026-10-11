/**
 * The shared hover preview's controller and placement (#2710): the pointer
 * delay and grace, the preview keeping itself open, hover over focus, Escape;
 * and where the preview sits against its anchor.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createNoteHover, NOTE_HOVER_CLOSE_GRACE_MS, NOTE_HOVER_OPEN_DELAY_MS } from '../../../src/renderer/lib/components/note-hover/note-hover.svelte';
import { placeHover, GAP, MARGIN } from '../../../src/renderer/lib/components/note-hover/hover-position';

const subject = (key: string) => ({ key, target: key, anchor: {} as Element });

afterEach(() => { vi.useRealTimers(); });

describe('createNoteHover (#2710)', () => {
  it('a hover opens after the link-hover delay; leaving closes after the grace', () => {
    vi.useFakeTimers();
    const h = createNoteHover();
    h.pointerEnter(subject('a'));
    vi.advanceTimersByTime(NOTE_HOVER_OPEN_DELAY_MS - 1);
    expect(h.current).toBeNull();
    vi.advanceTimersByTime(1);
    expect(h.current?.key).toBe('a');
    h.pointerLeave('a');
    vi.advanceTimersByTime(NOTE_HOVER_CLOSE_GRACE_MS - 1);
    expect(h.current?.key).toBe('a');
    vi.advanceTimersByTime(1);
    expect(h.current).toBeNull();
  });

  it('passing over an item without resting opens nothing', () => {
    vi.useFakeTimers();
    const h = createNoteHover();
    h.pointerEnter(subject('a'));
    h.pointerLeave('a');
    vi.advanceTimersByTime(1000);
    expect(h.current).toBeNull();
  });

  it('moving onto the preview keeps it open until the pointer leaves it', () => {
    vi.useFakeTimers();
    const h = createNoteHover();
    h.pointerEnter(subject('a'));
    vi.advanceTimersByTime(NOTE_HOVER_OPEN_DELAY_MS);
    h.pointerLeave('a');
    h.previewEnter();
    vi.advanceTimersByTime(5000);
    expect(h.current?.key).toBe('a');
    h.previewLeave();
    vi.advanceTimersByTime(NOTE_HOVER_CLOSE_GRACE_MS);
    expect(h.current).toBeNull();
  });

  it('focus opens at once and blur closes; a hover wins while it lasts, then focus returns', () => {
    vi.useFakeTimers();
    const h = createNoteHover();
    h.focus(subject('f'));
    expect(h.current?.key).toBe('f');
    h.pointerEnter(subject('p'));
    vi.advanceTimersByTime(NOTE_HOVER_OPEN_DELAY_MS);
    expect(h.current?.key).toBe('p');
    h.pointerLeave('p');
    vi.advanceTimersByTime(NOTE_HOVER_CLOSE_GRACE_MS);
    expect(h.current?.key).toBe('f');
    h.blur('other');
    expect(h.current?.key).toBe('f');
    h.blur('f');
    expect(h.current).toBeNull();
  });

  it('crossing onto another item and off it again before it opens closes the first preview (#2719)', () => {
    // Hover A; leave it (its close is scheduled) and, inside the grace, cross
    // B without resting. Entering B cancelled A's close; leaving B cancelled
    // B's open — and nothing put A's close back, so A's preview stayed up with
    // the pointer nowhere near it, until some other hover replaced it.
    vi.useFakeTimers();
    const h = createNoteHover();
    h.pointerEnter(subject('a'));
    vi.advanceTimersByTime(NOTE_HOVER_OPEN_DELAY_MS);
    expect(h.current?.key).toBe('a');
    h.pointerLeave('a');
    vi.advanceTimersByTime(50);
    h.pointerEnter(subject('b'));
    vi.advanceTimersByTime(50);
    h.pointerLeave('b');
    vi.advanceTimersByTime(NOTE_HOVER_CLOSE_GRACE_MS + NOTE_HOVER_OPEN_DELAY_MS);
    expect(h.current).toBeNull();
  });

  it('resting on the next item still hands straight over, with no gap (#2719)', () => {
    vi.useFakeTimers();
    const h = createNoteHover();
    h.pointerEnter(subject('a'));
    vi.advanceTimersByTime(NOTE_HOVER_OPEN_DELAY_MS);
    h.pointerLeave('a');
    h.pointerEnter(subject('b'));
    // A stays up while B's delay runs (no flicker to nothing between cards)…
    vi.advanceTimersByTime(NOTE_HOVER_OPEN_DELAY_MS - 1);
    expect(h.current?.key).toBe('a');
    // …and B replaces it when it opens.
    vi.advanceTimersByTime(1);
    expect(h.current?.key).toBe('b');
    vi.advanceTimersByTime(5000);
    expect(h.current?.key).toBe('b');
  });

  it('close (Escape) clears hover, focus and a pending open', () => {
    vi.useFakeTimers();
    const h = createNoteHover();
    h.focus(subject('f'));
    h.pointerEnter(subject('p'));
    h.close();
    vi.advanceTimersByTime(1000);
    expect(h.current).toBeNull();
  });
});

describe('placeHover (#2710)', () => {
  const vp = { width: 1000, height: 800 };
  it('under the anchor, left edges aligned', () => {
    expect(placeHover({ left: 100, top: 100, width: 50, height: 20 }, { width: 300, height: 100 }, vp)).toEqual({ left: 100, top: 120 + GAP });
  });
  it('above it when there is no room below', () => {
    expect(placeHover({ left: 100, top: 700, width: 50, height: 20 }, { width: 300, height: 100 }, vp)).toEqual({ left: 100, top: 700 - GAP - 100 });
  });
  it('inside the window at the right edge', () => {
    expect(placeHover({ left: 900, top: 100, width: 50, height: 20 }, { width: 300, height: 100 }, vp).left).toBe(1000 - MARGIN - 300);
  });
});
