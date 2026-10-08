/**
 * One link-hover preview everywhere (#2710, part 1). Hovering a `[[link]]` in
 * the editor (#1131) gives a note's title and the opening of its body. The
 * Preview pane's links, a Kanban card, a timeline event (by keyboard focus)
 * and a map pin must all show the SAME title and snippet for the same note,
 * now through the one shared `NoteHoverPreview`.
 *
 * Nothing here edits a note that's open in a preview, so the re-render race
 * of #2680 (`changingPreview` in preview-resize.spec.ts) can't arise: the
 * Preview pane is only hovered.
 *
 * Map tiles are served by the test (offline), as in map-style-per-view.spec.ts;
 * the pins are DOM markers, so they're hoverable whatever the tiles do.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { openEventTimeline, seedNotes } from './helpers/timeline';
import { openProjectBoard } from './helpers/kanban';

const STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'land', type: 'background', paint: { 'background-color': '#e9e4d6' } }],
};

const NOTES = {
  'projects/Garden Shed.md': '---\ntype: project\nstatus: active\n---\n# Garden Shed\n\nA cedar shed at the bottom of the garden, built over two summers.\n',
  'events/Moon landing.md': '---\ntype: event\ndate: 1969-07-20\n---\n# Moon landing\n\nThe Eagle has landed at Tranquility Base.\n',
  '.minerva/types/place.md': ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: location', '    type: geo', '    label: Location', '---', ''].join('\n'),
  'places/Kampa Museum.md': '---\ntype: place\nlocation: "50.0835,14.4089"\n---\n# Kampa Museum\n\nModern art on an island in the Vltava.\n',
  'Links.md': '# Links\n\nSee [[Garden Shed]] and [[Moon landing]] and [[Kampa Museum]].\n',
};
const TARGETS = ['Garden Shed', 'Moon landing', 'Kampa Museum'] as const;

interface Shown { title: string; snippet: string }

/** The shared preview's title and snippet, once its note has loaded. */
async function sharedPreview(win: Page): Promise<Shown> {
  const tip = win.locator('.note-hover-preview');
  await expect(tip).toBeVisible({ timeout: 5_000 });
  await expect(tip).toHaveAttribute('role', 'tooltip');
  await expect(tip.locator('.nhp-snippet:not(.nhp-loading)')).toHaveCount(1, { timeout: 5_000 });
  return {
    title: (await tip.locator('.nhp-title-text').textContent()) ?? '',
    snippet: (await tip.locator('.nhp-snippet').textContent()) ?? '',
  };
}

async function pointerAway(win: Page): Promise<void> {
  await win.mouse.move(2, 2);
  await expect(win.locator('.note-hover-preview')).toHaveCount(0, { timeout: 5_000 });
}

test('map, Kanban and timeline hovers show the same preview as a link to the note (#2710)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-hover-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-hover-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, NOTES);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 950, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(STYLE) }));
    const row = win.locator('[data-relative-path="Links.md"]').first();
    await expect(row).toBeVisible({ timeout: 25_000 });

    const expected = new Map<string, Shown>();
    await test.step('the editor\'s link hover, the reference (#1131)', async () => {
      await row.click();
      await expect(win.locator('.cm-content')).toContainText('Kampa Museum', { timeout: 10_000 });
      for (const t of TARGETS) {
        await win.locator('.cm-content .cm-clickable-link', { hasText: t }).first().hover();
        const pop = win.locator('.cm-link-preview:not(.loading)');
        await expect(pop.locator('.title')).toHaveText(t, { timeout: 5_000 });
        expected.set(t, { title: (await pop.locator('.title').textContent())!, snippet: (await pop.locator('.body').textContent())! });
        await win.mouse.move(2, 2);
        await expect(win.locator('.cm-link-preview')).toHaveCount(0, { timeout: 5_000 });
      }
      expect(expected.get('Garden Shed')!.snippet).toContain('cedar shed');
    });

    await test.step('the Preview pane\'s links show the shared preview, with the same content', async () => {
      await win.getByRole('button', { name: 'Preview', exact: true }).click();
      for (const t of TARGETS) {
        const link = win.locator(`.preview .wiki-link[data-target="${t}"]`);
        await link.hover();
        expect(await sharedPreview(win)).toEqual(expected.get(t));
        await expect(link).toHaveAttribute('aria-describedby', /.+/);
        await pointerAway(win);
      }
    });

    await test.step('Kanban: hover a card', async () => {
      const { cardFor } = await openProjectBoard(win, 1);
      await cardFor('Garden Shed').hover();
      expect(await sharedPreview(win)).toEqual(expected.get('Garden Shed'));
      const id = await win.locator('.note-hover-preview').getAttribute('id');
      await expect(cardFor('Garden Shed')).toHaveAttribute('aria-describedby', id!);
      await expect(cardFor('Garden Shed')).not.toHaveAttribute('title', /.*/);
      await pointerAway(win);
    });

    await test.step('Timeline: focus an event by keyboard; Escape closes, focus stays', async () => {
      const { eventFor } = await openEventTimeline(win, 1);
      await eventFor('Moon landing').focus();
      const shown = await sharedPreview(win);
      expect(shown).toEqual(expected.get('Moon landing'));
      await expect(win.locator('.note-hover-preview .nhp-extra')).toContainText('1969');
      await win.keyboard.press('Escape');
      await expect(win.locator('.note-hover-preview')).toHaveCount(0);
      await expect(eventFor('Moon landing')).toBeFocused();
    });

    await test.step('Map: hover a pin', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Place view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Map' }).click();
      const pin = win.locator('.type-view-map .maplibregl-marker[aria-label="Kampa Museum"]');
      await expect(pin).toHaveCount(1, { timeout: 15_000 });
      await expect(pin).not.toHaveAttribute('title', /.*/);
      await pin.hover();
      expect(await sharedPreview(win)).toEqual(expected.get('Kampa Museum'));
      await pointerAway(win);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
