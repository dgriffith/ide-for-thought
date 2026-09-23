/**
 * The first window is not created behind an `await` (#2223).
 *
 * `main.ts:91` used to `await registerSkillsAtStartup()` before `createWindow()`
 * — ~50ms of stock-skill parsing that the window had no dependency on, sitting
 * in front of the one step that produces something for the user to look at. The
 * justifying comment ("before any menu is built") was true of the *menu*, which
 * is built after, not of the window.
 *
 * This is a **structural** gate rather than a boot-timing one on purpose
 * (#2229): "how many ms did startup take" on a loaded dev box measures the box,
 * while "no `await` runs before `createWindow`" is a property of the file that
 * holds or doesn't, identically on every machine. It also catches the general
 * case, not the specific regression — the next subsystem that wants to load
 * something at startup gets stopped here whether or not it is skills.
 *
 * The other half is the ordering the original comment was actually protecting:
 * skills must be registered before `buildMenu`, or the Learning / Research /
 * Analysis menus come up empty. Un-gating the window must not quietly drop
 * that, so it is asserted here too.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MAIN_TS = path.join(__dirname, '..', '..', 'src', 'main', 'main.ts');

/** Source with comments blanked out (length-preserving, so offsets still line
 *  up with the original) — an `await` in prose is not an `await` in code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** The body of `app.whenReady().then(async () => { … })`, brace-matched. */
function whenReadyBody(src: string): string {
  const marker = 'app.whenReady().then(async () => {';
  const start = src.indexOf(marker);
  expect(start, `${marker} not found in main.ts — this test needs updating`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start + marker.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start + marker.length, i);
    }
  }
  throw new Error('unbalanced braces in the app.whenReady body');
}

describe('startup: the window is not gated behind an await (#2223)', () => {
  const body = whenReadyBody(stripComments(fs.readFileSync(MAIN_TS, 'utf-8')));

  it('creates a window before the startup path awaits anything', () => {
    const firstWindow = body.indexOf('createWindow(');
    expect(firstWindow, 'main.ts no longer calls createWindow() on the ready path').toBeGreaterThan(-1);

    const before = body.slice(0, firstWindow);
    const awaits = [...before.matchAll(/\bawait\b/g)].map((m) => {
      const line = before.slice(0, m.index).split('\n').length;
      return `line ${line} of the whenReady body`;
    });
    expect(
      awaits,
      'something on the startup path is awaited before the first window exists. ' +
        'Start the work and await it after createWindow() instead — the user ' +
        'waits on an empty screen for everything in front of it.',
    ).toEqual([]);
  });

  it('still registers skills before the menu is built', () => {
    // The menu is assembled from the tool registry, so skills must be in it by
    // then — that ordering was never the reason to gate the *window*, but it is
    // a real constraint and un-gating must not lose it.
    const started = body.indexOf('registerSkillsAtStartup(');
    const awaited = body.indexOf('await skillsRegistered');
    // \b so `rebuildMenu(` — which contains the substring — isn't mistaken for it.
    const menu = body.search(/\bbuildMenu\(/);
    expect(started, 'startup no longer registers skills at all').toBeGreaterThan(-1);
    expect(awaited, 'the started skill registration is never awaited').toBeGreaterThan(-1);
    expect(menu, 'startup no longer builds the menu').toBeGreaterThan(-1);
    expect(started).toBeLessThan(awaited);
    expect(awaited).toBeLessThan(menu);
  });
});
