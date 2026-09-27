/**
 * Exporters compile the CSL style once per run, not once per note (#2408).
 *
 * `createRenderer()` builds a fresh `CSL.Engine`, and that construction is the
 * expensive part of a citation render: it compiles the style, at ~300ms for APA
 * and ~700ms for Chicago notes & bibliography, and far more under v8 coverage
 * on a contended machine. Every multi-note exporter used to call it once per
 * note plus once for the bundle bibliography, so a Chicago tree export of two
 * notes compiled the 242KB style three times — which is what pushed
 * `tree-markdown.test.ts`'s Chicago case to its 30s timeout under
 * `pnpm coverage`, and what made a 100-note project export pay ~30s to
 * recompile APA 100 times.
 *
 * Gated on COUNTS, not timings (#2229), and every count is paired with the
 * property that makes sharing an engine sound: the second note still gets a
 * fresh session. That needs a NOTE-class style, deliberately: an in-text
 * style cannot see the leak, because citeproc renumbers in-text marks from
 * scratch on every call (the wrapper passes an empty citationsPre), so with
 * IEEE a missing reset still renders note b's cite as [1]. What carries over
 * is the wrapper's footnote counter, and only a note style shows it: b's
 * footnote comes out as 2 instead of 1. Verified by dropping the `reset()`
 * from `createRendererSessions`: an IEEE version of the assertion passed, and
 * the note-style one below fails for all six exporters.
 *
 * The note style is a minimal user CSL file (`.minerva/csl-styles/`, #302)
 * rather than the bundled Chicago notes & bibliography, which would cost one
 * 242KB compile per test (several seconds under coverage). The style's size is
 * irrelevant to what is being checked, which is the wrapper's session state.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import type { Exporter, ExportInput, ExportPlan } from '../../../src/main/publish/types';
import { treeMarkdownExporter } from '../../../src/main/publish/exporters/tree-markdown';
import { treeHtmlExporter } from '../../../src/main/publish/exporters/tree-html';
import { buildTreePdfHtml } from '../../../src/main/publish/exporters/tree-pdf';
import { staticSiteExporter } from '../../../src/main/publish/exporters/static-site';
import { noteMarkdownExporter } from '../../../src/main/publish/exporters/note-markdown';
import { noteHtmlExporter } from '../../../src/main/publish/exporters/note-html';

/** A note-class style with the minimum citeproc needs: one citation layout, one bibliography layout. */
const TINY_NOTE_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="note" version="1.0" default-locale="en-US">
  <info>
    <title>Tiny note style (#2408 fixture)</title>
    <id>tiny-note</id>
    <updated>2026-09-27T00:00:00+00:00</updated>
  </info>
  <citation>
    <layout suffix=".">
      <text variable="title"/>
    </layout>
  </citation>
  <bibliography>
    <layout>
      <text variable="title"/>
    </layout>
  </bibliography>
</style>
`;
const STYLE = 'tiny-note';

const TREE: ExportInput = { kind: 'tree', relativePath: 'root.md', maxDepth: 2 };
const PROJECT: ExportInput = { kind: 'project' };

let root: string;

beforeAll(async () => {
  // Read-only for every test below, so one fixture serves the whole file.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-engine-sessions-'));
  const sources: Array<[string, string, string]> = [
    ['foo-2020', 'Foo Studies', 'Foo, Alice'],
    ['bar-2021', 'Bar Studies', 'Bar, Bob'],
  ];
  for (const [id, title, creator] of sources) {
    await fsp.mkdir(path.join(root, '.minerva/sources', id), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources', id, 'meta.ttl'),
      `this: a thought:Article ;\n  dc:title "${title}" ;\n  dc:creator "${creator}" ;\n  dc:issued "2020"^^xsd:gYear .\n`,
      'utf-8');
  }
  await fsp.mkdir(path.join(root, '.minerva/csl-styles'), { recursive: true });
  await fsp.writeFile(path.join(root, '.minerva/csl-styles', `${STYLE}.csl`), TINY_NOTE_STYLE, 'utf-8');
  await fsp.writeFile(path.join(root, 'root.md'), '# Root\n\nSee [[a]] and [[b]].\n', 'utf-8');
  await fsp.writeFile(path.join(root, 'a.md'), '# A\n\nFirst [[cite::foo-2020]].\n', 'utf-8');
  await fsp.writeFile(path.join(root, 'b.md'), '# B\n\nSecond [[cite::bar-2021]].\n', 'utf-8');
});

afterAll(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

/** Resolve a plan and spy on the one call that compiles a CSL engine. */
async function planWithSpy(input: ExportInput) {
  const plan = await resolvePlan(root, input, { citationStyle: STYLE });
  // Guard the fixture itself: an unparseable user style silently falls back
  // to APA (in-text), under which the session assertions below cannot fail.
  expect(plan.citations!.styleId).toBe(STYLE);
  const createRenderer = vi.spyOn(plan.citations!, 'createRenderer');
  return { plan, createRenderer };
}

async function textOf(exporter: Exporter, plan: ExportPlan, file: string): Promise<string> {
  const output = await runExporter(exporter, plan);
  const zipped = output.files.find((f) => f.path.endsWith('.zip'));
  if (zipped) {
    const zip = await JSZip.loadAsync(zipped.contents);
    return zip.file(file)!.async('string');
  }
  const hit = output.files.find((f) => f.path === file);
  if (!hit) throw new Error(`no ${file} in [${output.files.map((f) => f.path).join(', ')}]`);
  return hit.contents as string;
}

interface Case {
  name: string;
  input: ExportInput;
  /** Everything the export produced that should carry note b's rendering. */
  render(plan: ExportPlan): Promise<string>;
}

const CASES: Case[] = [
  { name: 'tree-markdown', input: TREE, render: (p) => textOf(treeMarkdownExporter, p, 'b.md') },
  { name: 'tree-html', input: TREE, render: (p) => textOf(treeHtmlExporter, p, 'b.html') },
  // `run` goes on to print a PDF through Electron; the HTML build is where
  // every citation is rendered, so that is the part exercised here.
  { name: 'tree-pdf', input: TREE, render: async (p) => (await buildTreePdfHtml(p)).html },
  { name: 'static-site', input: PROJECT, render: (p) => textOf(staticSiteExporter, p, 'b.html') },
  { name: 'note-markdown', input: PROJECT, render: (p) => textOf(noteMarkdownExporter, p, 'b.md') },
  { name: 'note-html', input: PROJECT, render: (p) => textOf(noteHtmlExporter, p, 'b.html') },
];

describe.each(CASES)('$name', ({ input, render }) => {
  it('compiles the CSL style once for the whole export, however many notes cite', async () => {
    const { plan, createRenderer } = await planWithSpy(input);
    await render(plan);
    expect(createRenderer).toHaveBeenCalledTimes(1);
  });

  it('still starts each note on a fresh citation session (b\'s first footnote is 1, not 2)', async () => {
    const { plan } = await planWithSpy(input);
    const out = await render(plan);
    // `[^N]` in the markdown exporters, `fnref-N` in the HTML ones. For
    // tree-pdf `out` is the whole document, and it holds no 2 only if every
    // chapter restarted at 1.
    expect({ one: /\[\^1\]|fnref-1"/.test(out), two: /\[\^2\]|fnref-2"/.test(out) })
      .toEqual({ one: true, two: false });
  });
});

describe('per-note citation output is scoped to that note', () => {
  it('note-markdown: b carries only the source b cites, not the one a cited earlier in the run', async () => {
    const { plan } = await planWithSpy(PROJECT);
    const b = await textOf(noteMarkdownExporter, plan, 'b.md');
    // b's body names neither title, so any mention comes from its citation tail.
    expect({ bar: b.includes('Bar Studies'), foo: b.includes('Foo Studies') })
      .toEqual({ bar: true, foo: false });
  });
});

describe('an export with no citation assets', () => {
  it('still exports, with no renderer to share', async () => {
    const plan: ExportPlan = { ...(await resolvePlan(root, PROJECT)), citations: undefined };
    const out = await textOf(noteMarkdownExporter, plan, 'b.md');
    // No renderer → the cite has nothing to resolve through, and nothing throws.
    expect(out).toContain('# B');
  });
});
