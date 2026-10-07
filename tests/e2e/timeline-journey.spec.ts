/**
 * The Timeline journey (#2610, epic #2606), end to end in one flow: open
 * Events as a timeline, zoom it from the keyboard, step to an event and open
 * it with Enter, come back and switch to the List alternative and back, save
 * the timeline as a note (checking its `object-view` fence carries the
 * layout and the zoomed range), and export that note through the real
 * `publish.runExport`.
 *
 * `timeline-layout` checks the drawing's pieces (the wheel, Fit, the range
 * round-trip); this one checks they add up: a timeline zoomed and used in
 * its tab is the timeline that lands in a note and an export.
 *
 * The events cover what a timeline has to draw: a point, a span, a partial
 * date (`1969-08`, drawn as the whole of August, approximate), a BCE date
 * (`-0043-03-15`, 44 BC), a Meeting (an Event subtype, #2612), and an event
 * with no date, which goes to the Undated tray.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { domainOf, domainWidth, openEventTimeline, seedNotes, type SeedNotes } from './helpers/timeline';

const NOTES: SeedNotes = {
  'events/Ides of March.md': '---\ntype: event\ndate: -0043-03-15\n---\n# Ides of March\n',
  'events/Apollo 11.md': '---\ntype: event\ndate: 1969-07-16\nend: 1969-07-24\n---\n# Apollo 11\n',
  'events/Moon landing.md': '---\ntype: event\ndate: 1969-07-20\n---\n# Moon landing\n',
  'events/Woodstock.md': '---\ntype: event\ndate: 1969-08\n---\n# Woodstock\n',
  'events/Someday.md': '---\ntype: event\n---\n# Someday\n',
  'meetings/Splashdown debrief.md': '---\ntype: meeting\ndate: 1969-07-25\n---\n# Splashdown debrief\n',
};
/** The dated events, in time order — the keyboard's and the list's order. */
const IN_TIME_ORDER = ['Ides of March', 'Apollo 11', 'Moon landing', 'Splashdown debrief', 'Woodstock'];
const MOON_LANDING = Date.UTC(1969, 6, 20);
const IDES_OF_MARCH = Date.UTC(-43, 2, 15); // astronomical year -43 = 44 BC

/** The year a date value starts in: `-0043-03-15` → -43, `1969` → 1969. */
const yearOf = (value: string): number => Number(/^([+-]?\d+)/.exec(value)![1]);

test('the Timeline journey: Events as a timeline, zoomed and stepped by keyboard, listed, saved as a note, exported (#2610)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-timeline-journey-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-timeline-journey-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-timeline-journey-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, NOTES);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    const { events, eventFor, undated } = await test.step('open Events as a timeline: every dated event drawn, the undated one in the tray', async () => {
      const t = await openEventTimeline(win, IN_TIME_ORDER.length);
      await expect(t.eventFor('Ides of March')).toHaveAttribute('aria-label', /^Ides of March, (Mar 15, 44 BC|15 Mar 44 BC)$/);
      await expect(t.eventFor('Splashdown debrief')).toHaveCount(1); // a Meeting is an Event
      await expect(t.eventFor('Woodstock')).toHaveClass(/approx/);
      await expect(t.undated).toContainText('Someday');
      await expect(t.undated).toContainText('No date');
      return t;
    });
    const fitWidth = await domainWidth(win);

    await test.step('zoom from the keyboard: + twice, − once', async () => {
      await win.getByRole('button', { name: 'List' }).focus();
      await win.keyboard.press('Tab'); // the drawing is one tab stop
      await expect(win.locator('.tl-plot [data-timeline-event][tabindex="0"]')).toBeFocused();
      await win.keyboard.press('Home');
      await expect(eventFor('Ides of March')).toBeFocused();
      let before = await domainWidth(win);
      await win.keyboard.press('+');
      await expect.poll(() => domainWidth(win)).toBeLessThan(before);
      before = await domainWidth(win);
      await win.keyboard.press('+');
      await expect.poll(() => domainWidth(win)).toBeLessThan(before);
      before = await domainWidth(win);
      await win.keyboard.press('-');
      await expect.poll(() => domainWidth(win)).toBeGreaterThan(before);
      expect(await domainWidth(win)).toBeLessThan(fitWidth);
      // + and − zoom about the focused event, so 44 BC is still in view.
      const d = await domainOf(win);
      expect(d.start).toBeLessThanOrEqual(IDES_OF_MARCH);
      expect(d.end).toBeGreaterThan(IDES_OF_MARCH);
    });

    await test.step('step to Moon landing and open it with Enter', async () => {
      await win.keyboard.press('ArrowRight');
      await expect(eventFor('Apollo 11')).toBeFocused(); // panned into view: 44 BC no longer fits beside it
      await expect.poll(async () => (await domainOf(win)).end).toBeGreaterThan(Date.UTC(1969, 6, 24));
      await win.keyboard.press('ArrowRight');
      await expect(eventFor('Moon landing')).toBeFocused();
      await expect(win.getByRole('tooltip')).toContainText('Moon landing');
      await win.keyboard.press('Enter');
      await expect(win.locator('.tab.active')).toContainText('Moon landing', { timeout: 10_000 });
    });

    await test.step('come back: still zoomed, still showing 1969', async () => {
      await win.locator('.tab', { hasText: 'Event' }).first().click();
      await expect(events.first()).toBeVisible({ timeout: 10_000 });
      const d = await domainOf(win);
      expect(d.end - d.start).toBeLessThan(fitWidth);
      expect(d.start).toBeLessThan(MOON_LANDING);
      expect(d.end).toBeGreaterThan(MOON_LANDING);
    });

    await test.step('the List alternative, and back to the drawing', async () => {
      const list = win.getByRole('button', { name: 'List' });
      await list.click();
      await expect(list).toHaveAttribute('aria-pressed', 'true');
      await expect(win.locator('.tl-plot')).toHaveCount(0);
      const rows = win.locator('.tl-list .tl-list-row');
      await expect(rows.locator('.tl-list-title')).toHaveText(IN_TIME_ORDER);
      await expect(rows.filter({ hasText: 'Ides of March' })).toContainText('44 BC');
      await expect(rows.filter({ hasText: 'Woodstock' })).toContainText('(approximate)');
      await expect(undated).toContainText('Someday'); // the tray is under both
      await list.click();
      await expect(list).toHaveAttribute('aria-pressed', 'false');
      await expect(events).toHaveCount(IN_TIME_ORDER.length);
    });

    const savedRel = 'Event timeline.md';
    await test.step('Save as note: the fence carries layout timeline and the zoomed range', async () => {
      const shown = await domainOf(win);
      await win.getByRole('button', { name: 'Save as note' }).click();
      await win.locator('input[aria-labelledby="prompt-dialog-title"]').press('Enter'); // accept the suggested name
      const saved = path.join(projectDir, savedRel);
      await expect.poll(() => fs.existsSync(saved), { timeout: 10_000 }).toBe(true);
      const body = fs.readFileSync(saved, 'utf-8');
      const spec = JSON.parse(/```object-view\n([\s\S]*?)\n```/.exec(body)![1]!) as Record<string, unknown>;
      expect(spec).toMatchObject({ typeId: 'event', layout: 'timeline' });
      // The range is the one on screen, rounded out to whole days or years:
      // zoomed in, so not fit-all, and around 1969 rather than 44 BC.
      expect(typeof spec['from'], 'the fence has a from').toBe('string');
      expect(typeof spec['to'], 'the fence has a to').toBe('string');
      const from = yearOf(spec['from'] as string);
      const to = yearOf(spec['to'] as string);
      expect(from).toBeLessThanOrEqual(new Date(shown.start).getUTCFullYear());
      expect(to).toBeGreaterThanOrEqual(new Date(shown.end - 1).getUTCFullYear());
      expect(from).toBeGreaterThan(-43);
      expect(from).toBeLessThanOrEqual(1969);
      expect(to).toBeGreaterThanOrEqual(1969);
    });

    // Nothing below touches a preview: the saved note opens, but the export
    // renders the view itself, so there is no 120ms preview re-render (#2680)
    // to wait out.
    const html = await test.step('export the saved note through the real pipeline', async () => {
      const res = await win.evaluate(async ([dir, rel]) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: rel }, outputDir: dir, linkPolicy: 'inline-title',
      }), [outDir, savedRel] as const);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });
    // The events are on the exported page, and the fence isn't left as
    // source. #2609 (static timelines in exports: the saved range, events
    // linked, partial dates marked approximate, an Undated list, the lane cap)
    // tightens these into checks on the timeline itself.
    for (const title of [...IN_TIME_ORDER, 'Someday']) expect(html, `${title} is in the export`).toContain(title);
    expect(html, 'no raw spec in the export').not.toContain('&quot;typeId&quot;');
    expect(html, 'no raw spec in the export').not.toContain('"typeId"');
    expect(html, 'no object-view code block in the export').not.toMatch(/<code[^>]*object-view/);
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
