/**
 * Shared steps for the Timeline specs (#2608, #2610, #2715): seed notes, open
 * the stock Event view (or any dated type's) on its Timeline tab, find events in the drawing, and
 * read the visible range the drawing reports.
 *
 * Events are found by their accessible name, which starts with the title
 * ("Moon landing, Jul 20, 1969"), so a locator never depends on lane or
 * position. The visible range is the plot's `data-domain-start` /
 * `data-domain-end`, in civil-axis ms (`date-precision.ts`).
 *
 * The timeline is the built-in Timeline plugin's since #2829, drawn in a
 * plugin frame: `timelineOf(win).frame` is where its drawing, toolbar, list
 * and Undated tray are. The keyboard follows focus into the frame, and boxes
 * inside it come back in the window's coordinates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';

/** `relative path → note text`. */
export type SeedNotes = Readonly<Record<string, string>>;

/** Write each note under `dir`, making its folders. */
export function seedNotes(dir: string, notes: SeedNotes): void {
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

export interface Timeline {
  /** The Timeline plugin's frame: the whole layout below the view's header. */
  frame: FrameLocator;
  /** Every drawn event. */
  events: Locator;
  /** A drawn event by its title. */
  eventFor(title: string): Locator;
  /** The Undated tray. */
  undated: Locator;
}

/** The `nth` timeline in the window (a tab's, or an embed's). */
export function timelineOf(win: Page, nth = 0): Timeline {
  const frame = win.locator('[data-plugin-layout="timeline"] iframe').nth(nth).contentFrame();
  return {
    frame,
    events: frame.locator('.tl-plot [data-timeline-event]'),
    eventFor: (title) => frame.locator(`.tl-plot [data-timeline-event][aria-label^="${title},"]`),
    undated: frame.locator('.tl-undated'),
  };
}

/** The drawing's visible range, civil-axis ms. */
export async function domainOf(win: Page, nth = 0): Promise<{ start: number; end: number }> {
  const plot = timelineOf(win, nth).frame.locator('.tl-plot');
  return {
    start: Number(await plot.getAttribute('data-domain-start')),
    end: Number(await plot.getAttribute('data-domain-end')),
  };
}

/** The visible range's width, ms — for "zoomed in" / "zoomed out" polls. */
export async function domainWidth(win: Page, nth = 0): Promise<number> {
  const d = await domainOf(win, nth);
  return d.end - d.start;
}

/** From the Objects panel, open the Event view on its Timeline tab and wait for `drawn` dated events. */
export async function openEventTimeline(win: Page, drawn: number): Promise<Timeline> {
  return openTypeTimeline(win, 'Event', drawn);
}

/** From the Objects panel, open a type's view (by its label) on its Timeline
 *  tab — any type with a date property offers one (#2715) — and wait for
 *  `drawn` dated events. */
export async function openTypeTimeline(win: Page, label: string, drawn: number): Promise<Timeline> {
  await win.locator('.panel-tab[title="Objects"]').first().click();
  await win.getByRole('button', { name: `Open ${label} view` }).click({ force: true });
  await win.getByRole('tab', { name: 'Timeline' }).click();
  await expect(win.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
  const t = timelineOf(win);
  await expect(t.events).toHaveCount(drawn, { timeout: 15_000 });
  return t;
}
