/**
 * @vitest-environment node
 *
 * Help → Documentation reaches the user manual, and the URL is written down
 * where someone would look for it (#2254).
 *
 * `DOCS_URL` pointed at `github.com/dgriffith/ide-for-thought/tree/main/docs`
 * — the repository's *developer* docs folder, a raw file listing of
 * `releasing.md`, `packaging.md`, `config-roots.md` and friends. The actual
 * user manual is 118 pages and 61,245 words, built from `website/docs/`,
 * CI-gated with zero orphans, and the app could not reach it. Coverage with no
 * path to it is zero.
 *
 * ── Why a parity test rather than just a corrected constant ─────────────────
 * The URL was wrong because it was **written down nowhere**. Not in
 * `docs/releasing.md`, not in `README.md`, not in the deploy script's own
 * output — so there was no second copy for anyone to keep the first in step
 * with, and no way to notice the drift. That is the epic's (#2268) whole
 * thesis: *prose describing behaviour drifts the moment nothing checks it
 * against the behaviour.*
 *
 * So the fix records the URL in `docs/releasing.md` beside the deploy-script
 * row, and this test makes the two copies check each other. It is the shape
 * `config-roots-doc.test.ts` already uses, and the shape Help → Keyboard
 * Shortcuts uses by deriving from the live menu template.
 *
 * What it cannot do is confirm the site is *up* — that would need a network
 * call, which does not belong in a unit suite. It was verified by hand when
 * this landed: `https://dgriffith.github.io/minerva/docs/` returned 200, as
 * did deep pages (`connecting-cli.html`, `connecting-mcp.html`), against 119
 * files in `website/docs/`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const menuSource = () => fs.readFileSync(path.join(ROOT, 'src', 'main', 'menu.ts'), 'utf-8');
const releasingDoc = () => fs.readFileSync(path.join(ROOT, 'docs', 'releasing.md'), 'utf-8');

/** The literal `DOCS_URL` the Help menu opens. */
function docsUrlFromMenu(): string {
  const m = /const DOCS_URL = '([^']+)'/.exec(menuSource());
  if (!m) throw new Error('DOCS_URL not found in src/main/menu.ts — has it been renamed?');
  return m[1]!;
}

/** The user-manual URL recorded in `docs/releasing.md`. */
function docsUrlFromDoc(): string {
  const m = /\*\*User manual:\*\*\s*<([^>]+)>/.exec(releasingDoc());
  if (!m) throw new Error('No "**User manual:** <url>" line in docs/releasing.md');
  return m[1]!;
}

describe('the Help menu points at the user manual (#2254)', () => {
  it('DOCS_URL is the docs site, not the repo tree', () => {
    const url = docsUrlFromMenu();
    expect(
      url,
      'Help → Documentation must open the user manual, not the repository\'s '
        + 'developer-docs folder (#2254).',
    ).not.toMatch(/github\.com\/[^/]+\/[^/]+\/tree\//);
    expect(url).toMatch(/^https:\/\//);
  });

  it('agrees with the URL recorded in docs/releasing.md', () => {
    // The actual guard. Either copy may be edited; they may not diverge.
    expect(
      docsUrlFromMenu(),
      'src/main/menu.ts and docs/releasing.md disagree about where the docs '
        + 'site lives. Update both (#2254).',
    ).toBe(docsUrlFromDoc());
  });

  it('the recorded URL is under the site that actually hosts the docs', () => {
    // `scripts/deploy-to-gh-pages.sh` publishes `website/` to the `gh-pages`
    // branch of dgriffith/minerva, so the manual is served from that repo's
    // Pages origin — NOT from the source repo. Pinned because the two-repo
    // split is the thing that made this confusing enough to get wrong.
    const deploy = fs.readFileSync(
      path.join(ROOT, 'scripts', 'deploy-to-gh-pages.sh'), 'utf-8');
    const repo = /REPO_URL="https:\/\/github\.com\/([^/]+)\/([^"]+)"/.exec(deploy);
    expect(repo, 'REPO_URL not found in deploy-to-gh-pages.sh').not.toBeNull();
    const [, owner, name] = repo!;
    expect(docsUrlFromMenu()).toContain(`${owner!.toLowerCase()}.github.io/${name}`);
  });

  it('the manual it points at is the one this repo builds', () => {
    // Guards the other direction: if `website/docs/` were emptied or moved,
    // the URL above would keep pointing at a site nothing here produces.
    const dir = path.join(ROOT, 'website', 'docs');
    const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
    expect(pages.length, 'website/docs/ no longer holds the user manual').toBeGreaterThan(100);
    expect(pages).toContain('index.html');
  });
});

describe('the Command Palette is a real menu item (#2256)', () => {
  it('appears in the menu template', () => {
    // Help → Keyboard Shortcuts derives its contents from the menu template
    // rather than restating them, so a binding with no menu item is invisible
    // to it. Adding the item IS the documentation fix — which only works while
    // the item exists.
    const source = menuSource();
    expect(source, 'no Command Palette menu item (#2256)').toContain("label: 'Command Palette'");
  });

  it('carries the accelerator the renderer actually binds', () => {
    // The value of deriving the shortcuts dialog from this template is that
    // the accelerator here is the one users are told about. If it disagreed
    // with the renderer's keymap, the dialog would confidently teach the wrong
    // key — worse than the silence it replaced.
    const source = menuSource();
    const idx = source.indexOf("label: 'Command Palette'");
    const near = source.slice(idx, idx + 200);
    expect(near).toMatch(/accelerator: 'CmdOrCtrl\+K'/);

    const keymap = fs.readFileSync(
      path.join(ROOT, 'src', 'renderer', 'lib', 'app', 'command-keymap.ts'), 'utf-8');
    expect(keymap, 'the renderer no longer binds the palette').toContain('toggleCommandPalette');
  });

  it('dispatches a channel rather than doing work inline', () => {
    // CLAUDE.md #2233: a menu item sends a channel, calls a window/app
    // lifecycle function, or calls a maintenance command — it does not execute
    // inline. Pinned because inline execution is exactly what made menu.ts a
    // second, unreviewed command surface.
    const source = menuSource();
    const idx = source.indexOf("label: 'Command Palette'");
    expect(source.slice(idx, idx + 200)).toContain('send(Channels.MENU_COMMAND_PALETTE)');
  });
});
