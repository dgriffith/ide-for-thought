/**
 * The Timeline layout (#2608): open the stock Event view as a timeline — a
 * point, a span, a partial date, an undated event and a Meeting (an Event
 * subtype, #2612) — zoom it, step through it by keyboard, open an event with
 * Enter, and check the visible range round-trips through `from`/`to` when the
 * layout is switched away and back.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { domainOf, openEventTimeline, seedNotes, type SeedNotes } from './helpers/timeline';

const NOTES: SeedNotes = {
  'events/Moon landing.md': '---\ntype: event\ndate: 1969-07-20\n---\n# Moon landing\n',
  'events/Apollo 11.md': '---\ntype: event\ndate: 1969-07-16\nend: 1969-07-24\n---\n# Apollo 11\n',
  'events/Woodstock.md': '---\ntype: event\ndate: 1969-08\n---\n# Woodstock\n',
  'events/Someday.md': '---\ntype: event\n---\n# Someday\n',
  'meetings/Splashdown debrief.md': '---\ntype: meeting\ndate: 1969-07-25\n---\n# Splashdown debrief\n',
};

test('an Event timeline: draw, zoom, keyboard, open, and the range round-trips (#2608)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-timeline-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-timeline-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, NOTES);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const { events, eventFor } = await test.step('open the Event view as a timeline', () => openEventTimeline(win, 4));

    await test.step('points, a span, a partial date, the Meeting, and the Undated tray', async () => {
      await expect(eventFor('Moon landing')).toHaveAttribute('aria-label', /^Moon landing, (20 Jul 1969|Jul 20, 1969)$/);
      await expect(eventFor('Splashdown debrief')).toHaveCount(1); // a Meeting is an Event
      await expect(eventFor('Woodstock')).toHaveClass(/approx/);
      await expect(win.locator('.tl-undated')).toContainText('Someday');
      await expect(win.locator('.tl-undated')).toContainText('No date');
    });

    await test.step('zoom in with the wheel', async () => {
      const before = await domainOf(win);
      const box = (await win.locator('.tl-viewport').boundingBox())!;
      await win.mouse.move(box.x + box.width / 2, box.y + 80);
      await win.mouse.wheel(0, -400);
      await expect.poll(async () => { const d = await domainOf(win); return d.end - d.start; }).toBeLessThan(before.end - before.start);
      const wheeled = await domainOf(win);
      await win.getByRole('button', { name: 'Zoom in' }).click();
      await expect.poll(async () => { const d = await domainOf(win); return d.end - d.start; }).toBeLessThan(wheeled.end - wheeled.start);
    });

    await test.step('step through by keyboard: one tab stop, ←/→, Home/End, Enter opens', async () => {
      await win.getByRole('button', { name: 'List' }).focus();
      await win.keyboard.press('Tab');
      const stop = win.locator('.tl-plot [data-timeline-event][tabindex="0"]');
      await expect(stop).toHaveCount(1);
      await expect(stop).toBeFocused();
      await win.keyboard.press('Home');
      await expect(eventFor('Apollo 11')).toBeFocused(); // the first in time order, panned into view
      await win.keyboard.press('ArrowRight');
      await expect(eventFor('Moon landing')).toBeFocused();
      await expect(win.getByRole('tooltip')).toContainText('Moon landing');
      await win.keyboard.press('ArrowRight');
      await expect(eventFor('Splashdown debrief')).toBeFocused();
      await win.keyboard.press('ArrowRight');
      await expect(eventFor('Woodstock')).toBeFocused();
      await win.keyboard.press('ArrowLeft');
      await expect(eventFor('Splashdown debrief')).toBeFocused();
      await win.keyboard.press('End');
      await expect(eventFor('Woodstock')).toBeFocused();
      await win.keyboard.press('Home');
      await win.keyboard.press('ArrowRight');
      await expect(eventFor('Moon landing')).toBeFocused();
      await win.keyboard.press('Enter');
      await expect(win.locator('.tab.active')).toContainText('Moon landing', { timeout: 10_000 });
    });

    await test.step('from/to round-trip: switch the layout away and back', async () => {
      await win.locator('.tab', { hasText: 'Event' }).first().click();
      await expect(events.first()).toBeVisible({ timeout: 10_000 });
      const shown = await domainOf(win);
      await win.getByRole('tab', { name: 'List' }).click();
      await expect(win.locator('.tl-plot')).toHaveCount(0);
      await win.getByRole('tab', { name: 'Timeline' }).click();
      await expect(events.first()).toBeVisible({ timeout: 10_000 });
      const back = await domainOf(win);
      // What was written covers what was shown, and not much more (whole days at most).
      expect(back.start).toBeLessThanOrEqual(shown.start);
      expect(back.end).toBeGreaterThanOrEqual(shown.end);
      expect(back.end - back.start).toBeLessThanOrEqual((shown.end - shown.start) * 1.25 + 2 * 86_400_000);
      expect(back.end - back.start).toBeLessThan(400 * 86_400_000); // still zoomed in, not fit-all
      // …and it is stable: the same range again after another round trip.
      await win.getByRole('tab', { name: 'Table' }).click();
      await win.getByRole('tab', { name: 'Timeline' }).click();
      await expect(events.first()).toBeVisible({ timeout: 10_000 });
      expect(await domainOf(win)).toEqual(back);
    });

    await test.step('Fit shows every dated event again', async () => {
      await win.getByRole('button', { name: 'Fit' }).click();
      const d = await domainOf(win);
      expect(d.start).toBeLessThan(Date.UTC(1969, 6, 16));
      expect(d.end).toBeGreaterThan(Date.UTC(1969, 8, 1));
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
