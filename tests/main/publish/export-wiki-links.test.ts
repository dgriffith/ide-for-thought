/**
 * Exports resolve wiki-links the way the app does (#2518).
 *
 * They used to match only a target's full thoughtbase-relative path, so the
 * common `[[Note Name]]`, a note-relative `[[sub/Note]]`, an alias and a case
 * variant all exported as dead text, with the target IN the export. Every form
 * now links, in every HTML and markdown exporter; markdown destinations are
 * valid CommonMark and relative to the file that holds them; and a link
 * resolves against the whole thoughtbase, so it never lands on a different
 * exported note than the one the app opens.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import JSZip from 'jszip';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { noteHtmlExporter } from '../../../src/main/publish/exporters/note-html';
import { treeHtmlExporter } from '../../../src/main/publish/exporters/tree-html';
import { staticSiteExporter } from '../../../src/main/publish/exporters/static-site';
import { noteMarkdownExporter } from '../../../src/main/publish/exporters/note-markdown';
import { treeMarkdownExporter } from '../../../src/main/publish/exporters/tree-markdown';
import { indexNote } from '../../../src/main/graph/index';
import { makeGraphProject, type GraphProject } from '../../helpers/temp-project';
import type { ExportInput, Exporter } from '../../../src/main/publish/types';

/** Every way the app lets a note name `trip/places/Kampa Museum.md`. */
const FORMS: Array<[string, string]> = [
  ['by name', '[[Kampa Museum]]'],
  ['note-relative', '[[places/Kampa Museum]]'],
  ['full path', '[[trip/places/Kampa Museum]]'],
  ['alias', '[[Kampa]]'],
  ['case variant', '[[kampa museum]]'],
  ['typed, with display', '[[references::Kampa Museum|the museum]]'],
];
const PLAN = ['# Plan', '', ...FORMS.map(([label, link]) => `${label.toUpperCase()}: ${link}`)].join('\n\n');
const PLACE = '---\naliases: [Kampa]\n---\n# Kampa Museum\n\nModern art on the river.\n';

async function seed(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, 'trip', 'places'), { recursive: true });
  await fsp.writeFile(path.join(root, 'trip', 'plan.md'), PLAN, 'utf-8');
  await fsp.writeFile(path.join(root, 'trip', 'places', 'Kampa Museum.md'), PLACE, 'utf-8');
}

const EXPORTERS: Array<[string, Exporter, ExportInput, RegExp]> = [
  ['note-html', noteHtmlExporter, { kind: 'folder', relativePath: 'trip' }, /plan\.html$/],
  ['static-site', staticSiteExporter, { kind: 'project' }, /plan\.html$/],
  ['tree-html', treeHtmlExporter, { kind: 'tree', relativePath: 'trip/plan.md' }, /\.html$/],
  ['note-markdown', noteMarkdownExporter, { kind: 'folder', relativePath: 'trip' }, /plan\.md$/],
  ['tree-markdown', treeMarkdownExporter, { kind: 'tree', relativePath: 'trip/plan.md' }, /plan\.md$/], // a zip; opened below
];

/** The exported document holding the plan note — inside a zip for the tree-markdown bundle. */
async function findDoc(files: Array<{ path: string; contents: unknown }>, pick: RegExp): Promise<string> {
  for (const f of files) {
    if (f.path.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(f.contents as Uint8Array);
      for (const [name, entry] of Object.entries(zip.files)) {
        if (pick.test(name)) return entry.async('string');
      }
    } else if (pick.test(f.path) && String(f.contents).includes('BY NAME:')) {
      return String(f.contents);
    }
  }
  throw new Error('plan document not found in the export');
}

/** The text of the line (paragraph) carrying one link form. */
function lineFor(doc: string, label: string): string {
  const start = doc.indexOf(`${label.toUpperCase()}:`);
  expect(start, `${label} line missing`).toBeGreaterThanOrEqual(0);
  return doc.slice(start, doc.indexOf('\n', start) === -1 ? undefined : doc.indexOf('\n', start));
}

describe('export wiki-links resolve like the app (#2518)', () => {
  let root: string;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-links-'));
    await seed(root);
  });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  for (const [name, exporter, input, pick] of EXPORTERS) {
    it(`${name}: every form the app resolves links to the note`, async () => {
      const plan = await resolvePlan(root, input, { linkPolicy: 'follow-to-file' });
      const out = await runExporter(exporter, plan);
      const doc = await findDoc(out.files, pick);
      for (const [label] of FORMS) {
        const line = lineFor(doc, label);
        expect(line, `${name} / ${label}`).not.toContain('wikilink-unresolved');
        expect(line, `${name} / ${label}`).toMatch(pick.source.includes('html') ? /<a href="[^"]*"/ : /\]\([^)]+\)/);
      }
      expect(lineFor(doc, 'typed, with display')).toContain('the museum');
    });
  }

  it('under inline-title, every form shows the note\'s title, not what was typed', async () => {
    const plan = await resolvePlan(root, { kind: 'folder', relativePath: 'trip' }, { linkPolicy: 'inline-title' });
    const doc = String((await runExporter(noteHtmlExporter, plan)).files.find((f) => /plan\.html$/.test(f.path))!.contents);
    for (const label of ['by name', 'note-relative', 'alias', 'case variant']) {
      expect(lineFor(doc, label)).toContain('<em>Kampa Museum</em>');
    }
  });

  it('html: the href is the target page, relative to the linking page, with the space encoded', async () => {
    const plan = await resolvePlan(root, { kind: 'folder', relativePath: 'trip' }, { linkPolicy: 'follow-to-file' });
    const doc = String((await runExporter(noteHtmlExporter, plan)).files.find((f) => /plan\.html$/.test(f.path))!.contents);
    expect(lineFor(doc, 'by name')).toContain('<a href="places/Kampa%20Museum.html">Kampa Museum</a>');
  });

  it('markdown: every link parses as a link, and its destination exists relative to its file', async () => {
    const plan = await resolvePlan(root, { kind: 'folder', relativePath: 'trip' }, { linkPolicy: 'follow-to-file' });
    const out = await runExporter(noteMarkdownExporter, plan);
    const written = new Set(out.files.map((f) => f.path));
    const file = out.files.find((f) => /plan\.md$/.test(f.path))!;
    const hrefs = new MarkdownIt().parse(String(file.contents), {})
      .flatMap((t) => t.children ?? [])
      .filter((t) => t.type === 'link_open')
      .map((t) => t.attrGet('href')!);
    expect(hrefs).toHaveLength(FORMS.length); // every link survived as a link — none left as literal text
    for (const href of hrefs) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), decodeURIComponent(href.split('#')[0])));
      expect(written.has(target), `${href} from ${file.path} → ${target}`).toBe(true);
    }
  });
});

describe('export wiki-links resolve against the whole thoughtbase (#2518)', () => {
  let project: GraphProject;
  beforeEach(async () => { project = await makeGraphProject('minerva-export-links-graph-'); });
  afterEach(async () => { await project.cleanup(); });

  it('a link the app sends OUTSIDE the export never lands on a different, exported note', async () => {
    // `[[Kampa]]`: the app resolves it to notes/Kampa.md (a filename match beats
    // an alias). Resolving against only the exported notes would fall through
    // to Kampa Museum's alias — linking the reader to the wrong place.
    const { root, ctx } = project;
    await seed(root);
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes', 'Kampa.md'), '# Kampa island\n', 'utf-8');
    await indexNote(ctx, 'trip/plan.md', PLAN);
    await indexNote(ctx, 'trip/places/Kampa Museum.md', PLACE);
    await indexNote(ctx, 'notes/Kampa.md', '# Kampa island\n');

    const plan = await resolvePlan(root, { kind: 'folder', relativePath: 'trip' }, { linkPolicy: 'follow-to-file' });
    expect(plan.linkTargets?.paths).toContain('notes/Kampa.md');
    const doc = String((await runExporter(noteHtmlExporter, plan)).files.find((f) => /plan\.html$/.test(f.path))!.contents);
    expect(lineFor(doc, 'alias')).not.toContain('Kampa%20Museum'); // not linked to the museum…
    expect(lineFor(doc, 'alias')).toContain('wikilink-unresolved'); // …because its real target isn't exported
    expect(lineFor(doc, 'by name')).toContain('href="places/Kampa%20Museum.html"');
  });
});
