/**
 * Plugin exporters (#2648): main resolves the plan and hands the handler each
 * note rendered (or as written) with nothing in scope; only well-formed files
 * at safe paths come back, and `runExport` writes them where the user chose.
 * The worker host itself is `plugin-worker-host.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useTempDir } from '../helpers/temp-project';
import type { PluginExporter } from '../../src/shared/plugins/format';
import type { ExportPlan } from '../../src/main/publish/types';

const h = vi.hoisted(() => ({
  identity: null as Record<string, unknown> | null,
  active: [] as { pluginId: string; exporter: PluginExporter }[],
  invoke: vi.fn(),
}));
vi.mock('../../src/main/plugins/code-plugins', () => ({ codePluginIdentity: () => h.identity, activePluginExporters: () => h.active, activePluginBlockSyntax: () => [] }));
vi.mock('../../src/main/plugin-worker-host', () => ({ invokePluginLogic: h.invoke }));

import { buildPluginPlan, checkedExport, exportWithPlugin, installPluginExporters, pluginExporters, PLUGIN_EXPORT_DEADLINE_MS } from '../../src/main/plugin-exporters';
import { setExtraExporters } from '../../src/main/publish/registry';
import { runExport } from '../../src/main/publish/run-export';

const EPUB: PluginExporter = { id: 'epub', label: 'EPUB', input: 'html', scopes: ['single-note', 'folder', 'project'], write: { handler: 'writeEpub' } };
const tmp = useTempDir('plugin-export-');

const note = (relativePath: string, content: string, title: string): ExportPlan['inputs'][number] =>
  ({ relativePath, kind: 'note', content, frontmatter: {}, title });
const planOf = (inputs: ExportPlan['inputs'], inputKind: ExportPlan['inputKind'] = 'folder'): ExportPlan =>
  ({ inputKind, inputs, excluded: [], linkPolicy: 'inline-title', assetPolicy: 'keep-relative', rootPath: tmp.root });

beforeEach(() => {
  h.identity = { id: 'epub', name: 'EPUB', version: '1.0.0', capabilities: ['notes:read'] };
  h.active = [{ pluginId: 'epub', exporter: EPUB }];
  h.invoke.mockReset();
});
afterEach(() => setExtraExporters(null));

describe('buildPluginPlan (#2648)', () => {
  it('hands each note as Minerva renders it for export, or as written', async () => {
    const plan = planOf([
      note('book/one.md', '---\nauthor: Ada\n---\n# One\n\nSome *text*.', 'One'),
      note('book/two.md', 'Two, with a [[one]] link.', 'Two'),
      { relativePath: 's', kind: 'source', content: 'x', frontmatter: {}, title: 'S' },
    ]);
    const html = await buildPluginPlan(EPUB, plan);
    expect(html.title).toBe('book');
    expect(html.notes.map((n) => n.path)).toEqual(['book/one.md', 'book/two.md']);
    expect(html.notes[0]!.html).toContain('<em>text</em>');
    expect(html.notes[0]!.html).not.toContain('author');
    expect(html.notes[1]!.markdown).toBeUndefined();

    const md = await buildPluginPlan({ ...EPUB, input: 'markdown' }, plan);
    expect(md.notes[0]).toEqual({ path: 'book/one.md', title: 'One', frontmatter: {}, markdown: '# One\n\nSome *text*.' });
  });

  it('names a note export after the note, and the project after the thoughtbase', async () => {
    expect((await buildPluginPlan(EPUB, planOf([note('a.md', 'A', 'Alpha')], 'single-note'))).title).toBe('Alpha');
    expect((await buildPluginPlan(EPUB, planOf([note('a.md', 'A', 'Alpha')], 'project'))).title).toBe(path.basename(tmp.root));
  });
});

describe('exportWithPlugin (#2648)', () => {
  it('runs the writer with the plan as data, nothing in scope, and the exporter\'s deadline', async () => {
    h.invoke.mockResolvedValue({ files: [{ path: 'Book.epub', base64: Buffer.from('PK').toString('base64') }] });
    const out = await exportWithPlugin('epub', EPUB, planOf([note('a.md', 'A', 'A')]));
    expect(h.invoke).toHaveBeenCalledWith('epub', 'writeEpub', expect.objectContaining({ exporter: 'epub', scope: 'folder' }),
      { rootPath: tmp.root, scope: [], deadlineMs: PLUGIN_EXPORT_DEADLINE_MS });
    expect(out).toEqual({ files: [{ path: 'Book.epub', contents: new Uint8Array(Buffer.from('PK')) }], summary: 'Exported Book.epub with EPUB.' });
  });

  it('refuses before running anything: a plugin that is off, no notes, or more than one message of them', async () => {
    await expect(exportWithPlugin('epub', EPUB, planOf([]))).rejects.toThrow('There are no notes to export as EPUB.');
    await expect(exportWithPlugin('epub', { ...EPUB, input: 'markdown' }, planOf([note('a.md', 'x'.repeat(1024 * 1024), 'A')])))
      .rejects.toThrow('EPUB can be handed about 1 MB of notes at once; these are 1.0 MB. Export fewer notes.');
    h.identity = null;
    await expect(exportWithPlugin('epub', EPUB, planOf([note('a.md', 'A', 'A')]))).rejects.toThrow('"epub" is not an enabled plugin with code.');
    expect(h.invoke).not.toHaveBeenCalled();
  });
});

describe('checkedExport (#2648)', () => {
  const check = (answer: unknown) => checkedExport('P', 'X', answer);
  it('takes text and bytes, with the plugin\'s summary', () => {
    expect(check({ files: [{ path: 'a/b.txt', text: 'hi' }, { path: 'c.bin', base64: 'AAE=' }], summary: 'Done.' }))
      .toEqual({ files: [{ path: 'a/b.txt', contents: 'hi' }, { path: 'c.bin', contents: new Uint8Array([0, 1]) }], summary: 'Done.' });
  });
  it.each([
    [{ files: [] }, '"files" must be a non-empty list'],
    [{ files: [{ path: '../out.txt', text: '' }] }, 'isn\'t a path inside the output folder'],
    [{ files: [{ path: '/etc/x', text: '' }] }, 'isn\'t a path inside the output folder'],
    [{ files: [{ path: '.git/config', text: '' }] }, 'isn\'t a path inside the output folder'],
    [{ files: [{ path: 'a\\..\\b', text: '' }] }, 'isn\'t a path inside the output folder'],
    [{ files: [{ path: 'A.txt', text: '' }, { path: 'a.txt', text: '' }] }, 'it names a.txt twice'],
    [{ files: [{ path: 'a', text: 'x', base64: 'eA==' }] }, 'exactly one of "text" and "base64"'],
    [{ files: [{ path: 'a', base64: 'not base64!' }] }, 'isn\'t base64'],
    [{ files: [{ path: 'a', text: 'x', mode: 0o755 }] }, 'unknown field "mode"'],
    [{ files: [{ path: 'a', text: 'x' }], write: 'elsewhere' }, 'unknown field "write"'],
    [{ files: Array.from({ length: 257 }, (_, i) => ({ path: `${i}`, text: '' })) }, 'at most 256'],
  ])('refuses %j', (answer, why) => {
    expect(() => check(answer)).toThrow(why);
  });
});

describe('pluginExporters (#2648)', () => {
  it('registers each in a family of its own, and runExport writes what it returns where the user chose', async () => {
    const [e] = pluginExporters();
    expect(e).toMatchObject({ id: 'plugin:epub/epub', label: 'EPUB', group: 'plugin:epub/epub', acceptedKinds: ['single-note', 'folder', 'project'] });
    expect(e!.groupMeta).toEqual({ id: 'plugin:epub/epub', label: 'EPUB', category: 'publication', order: 100 });
    expect(e!.accepts({ kind: 'tree' })).toBe(false);

    fs.writeFileSync(path.join(tmp.root, 'a.md'), '# A\n\nBody.');
    installPluginExporters();
    h.invoke.mockResolvedValue({ files: [{ path: 'books/A.epub', base64: Buffer.from('book').toString('base64') }], summary: 'Made a book.' });
    const out = path.join(tmp.root, 'out');
    const r = await runExport(tmp.root, { exporterId: 'plugin:epub/epub', input: { kind: 'single-note', relativePath: 'a.md' }, outputDir: out });
    expect(r).toMatchObject({ filesWritten: 1, summary: 'Made a book.' });
    expect(fs.readFileSync(path.join(out, 'books', 'A.epub'), 'utf-8')).toBe('book');
  });
});
