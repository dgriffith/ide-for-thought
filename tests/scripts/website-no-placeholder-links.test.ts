/**
 * Guard against dead `href="#"` placeholder links shipping on the marketing
 * site / docs (website/**\/*.html).
 *
 * `href="#"` is the "I'll wire this up later" stub — it renders as a normal
 * link but goes nowhere (jumps to the top of the page). Several shipped with
 * early pages (blog link, build-from-source, footer Source/Learn columns) and
 * were only caught by eye. This scans every website HTML page and fails with
 * the exact file:line of any placeholder so the next one is caught at PR time
 * instead of by a visitor clicking a dead link.
 *
 * Real in-page anchors (`href="#some-id"`) are fine — only the empty `#` is a
 * placeholder. If you ever genuinely need an inert `#` link, use a <button> or
 * give it a real target; don't loosen this test.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEBSITE_DIR = path.join(ROOT, 'website');

function htmlFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((rel) => rel.endsWith('.html'))
    .map((rel) => path.join(dir, rel));
}

/** Every `href="#"` occurrence as `website-relative-path:line`. */
function placeholderLinks(): string[] {
  const hits: string[] = [];
  for (const file of htmlFiles(WEBSITE_DIR)) {
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes('href="#"')) {
        hits.push(`${path.relative(WEBSITE_DIR, file)}:${i + 1}`);
      }
    });
  }
  return hits;
}

describe('website has no placeholder links', () => {
  it('no page ships a dead href="#" (use a real target or a <button>)', () => {
    expect(placeholderLinks()).toEqual([]);
  });
});
