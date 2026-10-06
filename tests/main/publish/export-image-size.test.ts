/**
 * Image size carries through every export (#2666): the HTML exports (note
 * HTML, tree HTML, static site — and the PDFs, which print the same body)
 * emit `width` / `height` on the `<img>`, and the markdown exports keep the
 * `|400` suffix verbatim.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { noteHtmlExporter } from '../../../src/main/publish/exporters/note-html';
import { treeHtmlExporter } from '../../../src/main/publish/exporters/tree-html';
import { staticSiteExporter } from '../../../src/main/publish/exporters/static-site';
import { noteMarkdownExporter } from '../../../src/main/publish/exporters/note-markdown';
import { markdownExporter } from '../../../src/main/publish/exporters/markdown';
import type { Exporter } from '../../../src/main/publish/types';

// A 1×1 PNG, so the single-file exporters have something to inline.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const NOTE = '# Shots\n\n![shot|400](pic.png)\n\n![diagram|300x200](pic.png)\n\n![a|b](pic.png)\n';

let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-image-size-'));
  await fsp.writeFile(path.join(root, 'shots.md'), NOTE, 'utf-8');
  await fsp.writeFile(path.join(root, 'pic.png'), PNG);
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

async function exportText(exporter: Exporter, kind: 'single-note' | 'project', pick: (p: string) => boolean): Promise<string> {
  const input = kind === 'single-note' ? { kind, relativePath: 'shots.md' } as const : { kind } as const;
  const plan = await resolvePlan(root, input, { linkPolicy: 'inline-title' });
  const out = await runExporter(exporter, plan);
  const file = out.files.find((f) => pick(f.path));
  expect(file, out.files.map((f) => f.path).join(', ')).toBeDefined();
  return String(file!.contents);
}

describe('image size in HTML exports (#2666)', () => {
  for (const [name, exporter, kind, pick] of [
    ['note HTML', noteHtmlExporter, 'single-note', (p: string) => p.endsWith('.html')],
    ['tree HTML', treeHtmlExporter, 'project', (p: string) => p.endsWith('.html')],
    ['static site', staticSiteExporter, 'project', (p: string) => p === 'shots.html'],
  ] as const) {
    it(`${name}: width (and height) on the <img>, suffix out of the alt`, async () => {
      const html = await exportText(exporter, kind, pick);
      expect(html).toMatch(/<img [^>]*alt="shot" width="400"/);
      expect(html).toMatch(/<img [^>]*alt="diagram" width="300" height="200"/);
      expect(html).toContain('alt="a|b"');
      expect(html).not.toContain('shot|400');
    });
  }
});

// The tree-markdown zip runs each note through the same rewrite as clean markdown.
describe('image size in markdown exports (#2666)', () => {
  for (const [name, exporter, kind] of [
    ['clean markdown', noteMarkdownExporter, 'single-note'],
    ['markdown passthrough', markdownExporter, 'project'],
  ] as const) {
    it(`${name}: keeps the suffix verbatim`, async () => {
      const md = await exportText(exporter, kind, (p) => p.endsWith('.md'));
      expect(md).toContain('![shot|400](pic.png)');
      expect(md).toContain('![diagram|300x200](pic.png)');
    });
  }
});
