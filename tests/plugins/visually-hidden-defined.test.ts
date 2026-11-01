/**
 * @vitest-environment node
 *
 * A built-in plugin's view runs in a frame that doesn't load the app's
 * `global.css`, so a class defined only there is unstyled inside it. The
 * calendar used `visually-hidden` for each day's screen-reader name and drew
 * "Sunday, 1 November 2026, no events" beside every day number. A plugin that
 * uses the class has to define it in its own CSS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.join(__dirname, '..', '..', 'plugins');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(p);
    return /\.(svelte|css|ts|html)$/.test(e.name) ? [p] : [];
  });
}

describe('built-in plugin views define the visually-hidden class they use', () => {
  const plugins = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const id of plugins) {
    const sources = files(path.join(ROOT, id)).map((f) => fs.readFileSync(f, 'utf8'));
    const uses = sources.some((s) => /class="(?:[^"]*\s)?visually-hidden(?:\s[^"]*)?"/.test(s));
    if (!uses) continue;
    it(id, () => {
      expect(sources.some((s) => /(^|[\s,}])\.visually-hidden\s*\{/m.test(s))).toBe(true);
    });
  }
});
