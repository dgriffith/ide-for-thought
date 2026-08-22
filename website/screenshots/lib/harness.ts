/**
 * Launch + setup helper for the docs screenshot harness.
 *
 * Boots the *packaged* app (native bindings guaranteed) against a throwaway copy
 * of the demo thoughtbase, restored via a seeded `session.json` — the same trick
 * the e2e smoke suite uses, so no open-dialog click-through. Forces the Honey
 * theme and a fixed window size + 2× device scale so every image is consistent.
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const projectRoot = path.resolve(__dirname, '..', '..', '..');

/** Curated demo thoughtbase. Copied per-run so captures can't dirty it. */
const DEMO_VAULT = path.join(os.homedir(), 'vaults', 'demo');

/** Where captured docs PNGs land. */
export const IMG_DIR = path.join(projectRoot, 'website', 'docs', 'img');

/** Where captured marketing-site PNGs land (index/features/getting-started). */
export const MARKETING_IMG_DIR = path.join(projectRoot, 'website', 'img');

/** Fixed capture geometry (logical px). 2× scale is applied at launch. */
export const WINDOW = { width: 1440, height: 900 };

/** Packaged app binary produced by `pnpm build:e2e`, or null if unbuilt. */
export function packagedBinary(): string | null {
  if (process.platform !== 'darwin') return null;
  const p = path.join(
    projectRoot, 'out', `Minerva-${process.platform}-${process.arch}`,
    'Minerva.app', 'Contents', 'MacOS', 'Minerva',
  );
  return fs.existsSync(p) ? p : null;
}

export interface Harness {
  app: ElectronApplication;
  win: Page;
  /** The throwaway copy of the demo vault this run is pointed at. Exposed so a
   *  spec can seed per-feature state that lives BESIDE the notes rather than in
   *  them — e.g. `.minerva/history/` for the History panel. */
  projectDir: string;
  cleanup: () => void;
}

/** Launch the app into a fresh copy of the demo vault, Honey theme, at WINDOW. */
export async function launchDemo(): Promise<Harness> {
  const binary = packagedBinary();
  if (!binary) throw new Error('packaged app not built — run `pnpm build:e2e` first');
  if (!fs.existsSync(DEMO_VAULT)) throw new Error(`demo vault not found at ${DEMO_VAULT}`);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-shots-userdata-'));
  // Copy the vault into a nicely-named leaf folder so the file-tree root reads
  // "Demo" in screenshots rather than a random temp-dir hash.
  const projectParent = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-shots-'));
  const projectDir = path.join(projectParent, 'Demo');
  fs.cpSync(DEMO_VAULT, projectDir, { recursive: true });
  // Drop the purpose-built showcase notes into the vault root so each feature
  // has a short, tightly-cropping note to photograph. Fixtures live in
  // per-section folders under fixtures/ (fixtures/notes, fixtures/settings, …);
  // every .md in any of them is copied to the vault root, so file-tree labels
  // (the note filename) stay unique across sections.
  const fixturesRoot = path.join(__dirname, '..', 'fixtures');
  if (fs.existsSync(fixturesRoot)) {
    for (const entry of fs.readdirSync(fixturesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(fixturesRoot, entry.name);
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.md')) fs.copyFileSync(path.join(dir, f), path.join(projectDir, f));
      }
    }
  }
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 60, y: 60, width: WINDOW.width, height: WINDOW.height, rootPath: projectDir }]),
  );

  const app = await electron.launch({
    executablePath: binary,
    args: [`--user-data-dir=${userDataDir}`, '--force-device-scale-factor=2'],
    timeout: 60_000,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  });

  const cleanup = () => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectParent, { recursive: true, force: true });
  };

  const win = await app.firstWindow({ timeout: 20_000 });
  await win.waitForLoadState('domcontentloaded');
  // Wait for the restored project to replace the welcome screen.
  await expect(win.getByRole('button', { name: 'Open Thoughtbase' }))
    .toHaveCount(0, { timeout: 30_000 });

  // Force Honey (the default warm palette) deterministically, regardless of the
  // host machine's light/dark preference, then re-render.
  await win.evaluate(() => localStorage.setItem('themeMode', 'dark'));
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByRole('button', { name: 'Open Thoughtbase' }))
    .toHaveCount(0, { timeout: 30_000 });
  // Let fonts, the graph index, and first paint settle.
  await win.waitForTimeout(1500);

  return { app, win, projectDir, cleanup };
}

/** Open a note by its file-tree label (the filename without extension). */
export async function openNote(win: Page, label: string): Promise<void> {
  const tree = win.locator('aside.sidebar');
  await tree.getByText(label, { exact: true }).first().click();
  // Editor swaps the "Select a note" placeholder for the note's content.
  await win.waitForTimeout(800);
}

/** Switch the active editor group's view mode via the toolbar toggle. */
export async function setView(win: Page, mode: 'Source' | 'Side by side' | 'Preview'): Promise<void> {
  await win.getByRole('button', { name: mode, exact: true }).first().click();
  await win.waitForTimeout(600);
}

/** Write a PNG into website/docs/img. Pass a Locator to crop, or omit for the
 *  full window. */
export async function shoot(win: Page, id: string, locator?: import('@playwright/test').Locator, dir: string = IMG_DIR): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${id}.png`);
  if (locator) await locator.screenshot({ path: out });
  else await win.screenshot({ path: out });
}

/**
 * Crop the Preview pane to its actual rendered height, so a short note yields a
 * tight image instead of the full fixed-height pane with empty space below.
 * Tall notes are capped at the pane height (shows the top of the note).
 */
export async function shootPreview(win: Page, id: string): Promise<void> {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  // Nudge a resize so any width:"container" chart re-measures its column (Vega
  // can lay out narrow if it measured before the pane finished sizing).
  await win.evaluate(() => window.dispatchEvent(new Event('resize')));
  await win.waitForTimeout(500);
  const el = win.locator('.preview').first();
  const box = await el.boundingBox();
  if (!box) throw new Error(`preview pane not visible for ${id}`);
  // The pane has min-height:100%, so scrollHeight always fills it. Measure the
  // real content extent: the lowest in-flow child (skipping the absolutely-
  // positioned tooltip/menu overlays), plus a little breathing room.
  const contentHeight = await el.evaluate((n) => {
    const pane = n as HTMLElement;
    const top = pane.getBoundingClientRect().top;
    let bottom = top;
    for (const child of Array.from(pane.children)) {
      const cs = getComputedStyle(child);
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.display === 'none') continue;
      const r = child.getBoundingClientRect();
      if (r.height === 0) continue;
      bottom = Math.max(bottom, r.bottom);
    }
    return bottom - top + 28; // bottom padding
  });
  const height = Math.min(contentHeight, Math.round(box.height));
  await win.screenshot({
    path: path.join(IMG_DIR, `${id}.png`),
    clip: { x: box.x, y: box.y, width: box.width, height },
  });
}
