/**
 * Every webContents and session starts deny-by-default (#2559).
 *
 * The guards live in one place — `security.ts`'s
 * `installGlobalWebContentsGuards`, hooked on `web-contents-created` and
 * `session-created` — so a window nobody thought about is still guarded.
 * Before this, the main window's guards were installed by its one
 * construction site, and the PDF-render and privileged-site login windows
 * had none: the login partition auto-approved mic, camera, location and
 * notifications for any page it reached.
 *
 * What this pins, structurally:
 *  - `main.ts` installs the global guards at module load, before
 *    `app.whenReady()` — so before any window can exist;
 *  - the hook covers both events;
 *  - permission handlers, `web-contents-created` listeners and an `allow`ing
 *    window-open handler appear ONLY in `security.ts` — an opt-in is a
 *    reviewed change there, not a local override somewhere else;
 *  - no `<webview>` tag or subframe Node integration is ever enabled;
 *  - the set of `new BrowserWindow(` sites is known. A new one fails here so
 *    its author decides, in the diff, whether the default (no navigation, no
 *    popups, no permissions) is right for it, and opts in through
 *    `security.ts` if not.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_MAIN = path.join(__dirname, '..', '..', 'src', 'main');
const rel = (abs: string) => path.relative(SRC_MAIN, abs).split(path.sep).join('/');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.ts$/.test(e.name) ? [full] : [];
  });
}

/** Source with comments blanked (length-preserving). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

const files = walk(SRC_MAIN).map((abs) => ({ rel: rel(abs), code: stripComments(fs.readFileSync(abs, 'utf-8')) }));
const filesMatching = (re: RegExp) => files.filter((f) => re.test(f.code)).map((f) => f.rel).sort();

/** Every `new BrowserWindow(` site, and why its default-deny posture is right. */
const KNOWN_WINDOW_SITES: Record<string, string> = {
  'window-manager.ts': 'the main window — opts in via installNavigationGuards (renderer entry only)',
  'privileged-sites.ts': 'the login window — opts its partition in via allowHttpsBrowsing (https + OAuth popups)',
  'publish/exporters/note-pdf/electron-render.ts': 'off-screen PDF render — needs nothing; stays fully denied',
  'legacy-storage-migration.ts': 'hidden one-shot reader of the old file:// localStorage (#2564) — loadFile is not a navigation; needs no popups or permissions; stays fully denied',
};

describe('webContents and sessions are deny-by-default (#2559)', () => {
  it('main.ts installs the global guards at module load, before app.whenReady()', () => {
    const main = files.find((f) => f.rel === 'main.ts')!.code;
    const install = main.indexOf('installGlobalWebContentsGuards()');
    const ready = main.indexOf('app.whenReady()');
    expect(install, 'main.ts must call installGlobalWebContentsGuards()').toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(-1);
    expect(install, 'installGlobalWebContentsGuards() must run before app.whenReady()').toBeLessThan(ready);
  });

  it('the global hook covers both web-contents-created and session-created', () => {
    const security = files.find((f) => f.rel === 'security.ts')!.code;
    expect(security).toMatch(/app\.on\(\s*'web-contents-created'/);
    expect(security).toMatch(/app\.on\(\s*'session-created'/);
  });

  it('permission handlers and web-contents-created listeners live only in security.ts', () => {
    expect(filesMatching(/\.setPermissionRequestHandler\(/)).toEqual(['security.ts']);
    expect(filesMatching(/\.setPermissionCheckHandler\(/)).toEqual(['security.ts']);
    expect(filesMatching(/'web-contents-created'/)).toEqual(['security.ts']);
    expect(filesMatching(/'session-created'/)).toEqual(['security.ts']);
  });

  it('only security.ts may return an allowing window-open decision', () => {
    expect(filesMatching(/action:\s*'allow'/)).toEqual(['security.ts']);
  });

  it('never enables <webview> or Node in subframes', () => {
    expect(filesMatching(/webviewTag:\s*true/)).toEqual([]);
    expect(filesMatching(/nodeIntegrationInSubFrames:\s*true/)).toEqual([]);
  });

  it('every new BrowserWindow( site is a known, reviewed one', () => {
    const sites = filesMatching(/new BrowserWindow\(/);
    const unknown = sites.filter((s) => !(s in KNOWN_WINDOW_SITES));
    expect(
      unknown,
      `New BrowserWindow construction site(s): ${unknown.join(', ')}. It starts deny-by-default ` +
        '(no navigation, popups, permissions or webviews). If that is right, add it to KNOWN_WINDOW_SITES ' +
        'with why; if not, opt it in through security.ts. See docs/architecture-ratchets.md.',
    ).toEqual([]);
    // Shrink-only: a removed site must leave the list too.
    expect(Object.keys(KNOWN_WINDOW_SITES).filter((s) => !sites.includes(s))).toEqual([]);
  });
});
