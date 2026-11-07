/**
 * No mac-only key symbols in text a Windows or Linux user reads (#2987).
 *
 * A shortcut shown to the user is formatted for their platform —
 * `formatAccelerator` in the renderer, `acceleratorLabel` in main — rather than
 * written as ⌘ / ⌥ / ⇧ / ⌃. This scans the two places such text lives:
 * Svelte markup (scripts, styles and comments are skipped; code comments may
 * name keys however they like) and the built-in plugins' descriptions.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const MAC_KEYS = /[⌘⌥⇧⌃]/;

function svelteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return svelteFiles(p);
    return e.name.endsWith('.svelte') ? [p] : [];
  });
}

/** The markup of a component: everything outside <script>, <style> and comments. */
function markup(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

describe('shortcuts are shown in the platform\'s own keys (#2987)', () => {
  it('no Svelte markup writes a mac key symbol', () => {
    const offenders = svelteFiles(path.join(ROOT, 'src', 'renderer'))
      .flatMap((file) => markup(fs.readFileSync(file, 'utf-8')).split('\n')
        // A `//` or `*` line is a comment inside a template expression, not text.
        .filter((line) => MAC_KEYS.test(line) && !/^\s*(\/\/|\*)/.test(line))
        .map((line) => `${path.relative(ROOT, file).split(path.sep).join('/')}: ${line.trim()}`));
    expect(offenders, 'format the shortcut with formatAccelerator() instead').toEqual([]);
  });

  it('no built-in plugin description writes one', () => {
    const core = fs.readFileSync(path.join(ROOT, 'src', 'main', 'plugins', 'core.ts'), 'utf-8');
    const offenders = core.split('\n').filter((line) => MAC_KEYS.test(line) && !line.trim().startsWith('//'));
    expect(offenders, 'use key(...) (acceleratorLabel) instead').toEqual([]);
  });
});
