/**
 * End-to-end coverage for #907 (the `:::argument` embed) — proves the whole
 * pipeline holds together in the real app: a note authored the way
 * `find-supporting-arguments.md` already authors one today (a plain note
 * with a `supports: <claim-uri>` frontmatter value) is picked up by the
 * embed's SPARQL traversal and rendered as a real, clickable outline.
 *
 * Every note is written to disk BEFORE `electron.launch()`, matching every
 * other e2e spec's fixture pattern — not via `window.api.notebase.writeFile`
 * after boot. A first attempt did the latter and was reliably flaky in CI:
 * the sidebar tree only picks up a post-boot IPC write via the filesystem
 * watcher's own broadcast (`NOTEBASE_WRITE_FILE`'s handler explicitly
 * suppresses its OWN broadcast — see the "Renderer-initiated save" comment in
 * register-notebase.ts — on the theory that the caller already knows what it
 * wrote), and that round-trip isn't proven-reliable within a short timeout on
 * a CI runner. Pre-placing files sidesteps the question entirely: they're
 * indexed the same way the initial `sample-project` fixture always has been.
 *
 * The one thing that DOES need a real value — the claim's graph URI, for the
 * grounds note's `supports:` frontmatter — is computed by hand rather than
 * looked up at runtime. The scheme (`baseUri + 'note/' + encoded relative
 * path`) is fully deterministic (`src/main/graph/uri-helpers.ts`'s `noteUri`),
 * and `.minerva/config.json` pins `baseUri` explicitly so the computation
 * doesn't depend on guessing the OS username / project dirname the real
 * auto-coining (`coinBaseUri`) would otherwise use.
 *
 * A second CI-only failure surfaced even after pre-placing: `Host.md` —
 * the note actually clicked through the sidebar — must live at the PROJECT
 * ROOT, not under a subfolder. `Sidebar.svelte`'s `expanded` state seeds to
 * `{}` on a fresh launch (`FileTree.svelte` only renders a folder's children
 * when `expanded[path]` is true), and there's no persisted session/tabs
 * state the way `tests/fixtures/sample-project`'s committed
 * `.minerva/tabs.json` gives every OTHER e2e spec that clicks a file under
 * `notes/` "for free." A root-level row isn't gated by `expanded` at all, so
 * it's always in the DOM regardless of prior UI state — the other notes this
 * spec writes (the claim, the grounds) stay under `notes/` since nothing
 * ever clicks them through the sidebar.
 *
 * Boots the in-tree `.vite/build` app, same as the other e2e specs — needs
 * `pnpm build:e2e` first (`pnpm test:e2e` does that).
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { launchMinerva } from './helpers/launch';

const BASE_URI = 'https://sample.minerva.dev/argument-map-e2e/';

/** Mirrors `noteUri()` in `src/main/graph/uri-helpers.ts` exactly — segment-
 *  wise encoding so slashes survive, `.md`/`.ttl` stripped. */
function noteUri(relativePath: string): string {
  const clean = relativePath.replace(/\.(md|ttl)$/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `${BASE_URI}note/${encoded}`;
}

function launchWithProject() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-argmap-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-argmap-project-'));

  fs.mkdirSync(path.join(projectDir, '.minerva'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.minerva', 'config.json'), JSON.stringify({ baseUri: BASE_URI }));

  fs.mkdirSync(path.join(projectDir, 'notes'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'notes', 'The Claim.md'),
    '---\ntitle: The Claim\n---\n\n# The Claim\n\nSome assertion.\n\n```turtle\nthis: a thought:Claim .\n```\n',
  );
  fs.writeFileSync(
    path.join(projectDir, 'notes', 'Cited Evidence.md'),
    `---\ntitle: Cited Evidence\nsupports: ${noteUri('notes/The Claim.md')}\n---\n\n# Cited Evidence\n\nThe supporting case.\n`,
  );
  // At the project root, not under notes/ — the sidebar tree starts with
  // every folder collapsed on a fresh launch (Sidebar.svelte's `expanded`
  // state seeds to `{}`; there's no persisted session/tabs state the way
  // tests/fixtures/sample-project's committed .minerva/tabs.json gives every
  // OTHER e2e spec that clicks a file under notes/ "for free"), so a nested
  // file's row never mounts in the DOM without first expanding its folder.
  // Root-level rows aren't gated by `expanded` at all.
  fs.writeFileSync(
    path.join(projectDir, 'Host.md'),
    '---\ntitle: Host\n---\n\n# Host\n\n:::argument\n[[The Claim]]\n:::\n',
  );

  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  return { userDataDir, projectDir };
}

async function waitForWorkspace(win: Page): Promise<void> {
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
}

test('argument map: renders a real supports edge as a clickable outline (#907)', async () => {
  const { userDataDir, projectDir } = launchWithProject();
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);

    await expect(win.locator('[data-relative-path="Host.md"]').first()).toBeVisible({ timeout: 10_000 });
    await win.locator('[data-relative-path="Host.md"]').first().click();
    await expect(win.locator('.cm-content')).toBeVisible({ timeout: 10_000 });

    await win.getByRole('button', { name: 'Preview', exact: true }).click();

    const outline = win.locator('.argument-map');
    await expect(outline).toBeVisible({ timeout: 10_000 });
    await expect(outline.getByText('The Claim')).toBeVisible();
    await expect(outline.getByRole('heading', { name: 'Support' })).toBeVisible({ timeout: 10_000 });
    await expect(outline.getByRole('button', { name: 'Cited Evidence' })).toBeVisible();

    // Clicking the grounds node navigates to it — the embed isn't just a
    // static rendering, the tree click wiring is real. The group's view mode
    // (Preview, set above) carries over to the newly-opened tab, so check
    // whatever's rendering rather than assuming an editor mounted.
    await outline.getByRole('button', { name: 'Cited Evidence' }).click();
    await expect(win.getByText('The supporting case')).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
