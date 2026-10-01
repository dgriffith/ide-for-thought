/**
 * Hidden fences (#2039) never reach an exported or published page (#2509).
 *
 * A `-hidden` fence is machine-facing content — graph-real, rendered as
 * nothing in the preview. Every HTML-family export used to print it verbatim
 * in a code box. The PDF exporters print HTML from the same `renderNoteBody`,
 * so it is checked directly. The clean-markdown and pandoc exports drop it
 * too; only the Minerva-internal passthrough `markdown` exporter keeps it.
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
import { pandocExporter } from '../../../src/main/publish/exporters/pandoc';
import { renderNoteBody } from '../../../src/main/publish/exporters/note-html/render';

const CANARY = 'urn:canary:hidden-fence';
const NOTE = [
  '# Visible', '',
  'Before.', '',
  '```turtle-hidden', `<${CANARY}> <urn:p> "secret" .`, '```', '',
  'After.', '',
  '```TURTLE-HIDDEN', `<${CANARY}2> <urn:p> "also" .`, '```', '',
].join('\n');

let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-hidden-fence-'));
  await fsp.writeFile(path.join(root, 'note.md'), NOTE, 'utf-8');
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

const allText = (files: { contents: unknown }[]) => files.map((f) => String(f.contents)).join('\n');

describe('hidden fences in exports (#2509)', () => {
  it('are absent from the HTML every HTML/PDF exporter renders', async () => {
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'note.md' });
    const html = await renderNoteBody(plan.inputs[0]!, plan);
    expect(html).toContain('Before.');
    expect(html).toContain('After.');
    expect(html).not.toContain('canary');
  });

  for (const [name, exporter, input] of [
    ['note-html', noteHtmlExporter, { kind: 'single-note', relativePath: 'note.md' }],
    ['tree-html', treeHtmlExporter, { kind: 'tree', relativePath: 'note.md' }],
    ['static-site', staticSiteExporter, { kind: 'project' }],
  ] as const) {
    it(`are absent from a ${name} export`, async () => {
      const plan = await resolvePlan(root, input);
      const out = await runExporter(exporter, plan);
      const text = allText(out.files);
      expect(text).toContain('After.');
      expect(text).not.toContain('canary');
    });
  }

  it('are dropped from the reader-facing markdown exports, any language, any case', async () => {
    await fsp.writeFile(path.join(root, 'note.md'), `${NOTE}\n\`\`\`json-hidden\n{"k":"${CANARY}3"}\n\`\`\`\n`, 'utf-8');
    for (const exporter of [noteMarkdownExporter, pandocExporter]) {
      const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'note.md' });
      const text = allText((await runExporter(exporter, plan)).files);
      expect(text, exporter.id).toContain('After.');
      expect(text, exporter.id).not.toContain('canary');
    }
  });

  it('stay in the Minerva-internal passthrough markdown export, which is the source', async () => {
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'note.md' });
    expect(allText((await runExporter(markdownExporter, plan)).files)).toContain('```turtle-hidden');
  });
});
