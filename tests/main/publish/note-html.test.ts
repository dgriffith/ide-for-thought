import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { noteHtmlExporter } from '../../../src/main/publish/exporters/note-html';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import type { ExportPlan } from '../../../src/main/publish/types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-note-html-test-'));
}

function planWithNote(overrides: Partial<ExportPlan['inputs'][number]>, planOverrides: Partial<ExportPlan> = {}): ExportPlan {
  return {
    inputKind: 'single-note',
    inputs: [
      {
        relativePath: 'notes/x.md',
        kind: 'note',
        content: '',
        frontmatter: {},
        title: 'X',
        ...overrides,
      },
    ],
    excluded: [],
    linkPolicy: 'inline-title',
    assetPolicy: 'keep-relative',
    ...planOverrides,
  };
}

describe('noteHtmlExporter (#248)', () => {
  let root: string;

  beforeEach(() => { root = mkTempProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('emits a self-contained HTML file with inline stylesheet + article body', async () => {
    const plan = planWithNote({ content: '# Hello\n\nA paragraph.\n', title: 'Hello' });
    const output = await noteHtmlExporter.run(plan);
    expect(output.files).toHaveLength(1);
    const html = String(output.files[0].contents);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Hello</title>');
    expect(html).toContain('minerva-export-version');
    expect(html).toContain('<style>');
    expect(html).toContain('<article>');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<p>A paragraph.</p>');
    // Guard against accidentally leaving external CSS / JS refs.
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).not.toMatch(/<script/);
  });

  it('single-note scope flattens output to <basename>.html so export-to-home-dir doesn\'t bury the file', async () => {
    const plan = planWithNote({ relativePath: 'notes/nested/thing.md' });
    const output = await noteHtmlExporter.run(plan);
    expect(output.files[0].path).toBe('thing.html');
  });

  it('multi-note scope preserves the source tree so follow-to-file links resolve', async () => {
    const plan: ExportPlan = {
      inputKind: 'project',
      inputs: [
        { relativePath: 'notes/a.md', kind: 'note', content: '# A\n', frontmatter: {}, title: 'A' },
        { relativePath: 'notes/sub/b.md', kind: 'note', content: '# B\n', frontmatter: {}, title: 'B' },
      ],
      excluded: [],
      linkPolicy: 'follow-to-file',
      assetPolicy: 'keep-relative',
    };
    const output = await noteHtmlExporter.run(plan);
    const paths = output.files.map((f) => f.path).sort();
    expect(paths).toEqual(['notes/a.html', 'notes/sub/b.html']);
  });

  it('strips frontmatter from the rendered body', async () => {
    const plan = planWithNote({
      content: '---\ntitle: X\nfoo: bar\n---\n\n# Body heading\n',
    });
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    expect(html).not.toMatch(/foo:\s*bar/);
    expect(html).toContain('<h1>Body heading</h1>');
  });

  it('linkPolicy inline-title emits <em>title</em> for wiki-links', async () => {
    const plan = planWithNote(
      { content: '# X\n\nSee [[notes/other]].\n' },
      {
        inputs: [
          { relativePath: 'notes/x.md', kind: 'note', content: '# X\n\nSee [[notes/other]].\n', frontmatter: {}, title: 'X' },
          { relativePath: 'notes/other.md', kind: 'note', content: '', frontmatter: {}, title: 'Other Title' },
        ],
      },
    );
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('<em>Other Title</em>');
    expect(html).not.toContain('notes/other');
  });

  it('linkPolicy follow-to-file emits .html-linked anchors only when target is in plan', async () => {
    const plan: ExportPlan = {
      inputKind: 'project',
      inputs: [
        { relativePath: 'a.md', kind: 'note', content: '# A\n\nTo [[b]] and [[nowhere]].\n', frontmatter: {}, title: 'A' },
        { relativePath: 'b.md', kind: 'note', content: '', frontmatter: {}, title: 'B' },
      ],
      excluded: [],
      linkPolicy: 'follow-to-file',
      assetPolicy: 'keep-relative',
    };
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('<a href="b.html">B</a>');
    // Unresolved target falls back to an italicised title.
    expect(html).toContain('class="wikilink-unresolved"');
  });

  it('linkPolicy drop emits plain text, no link / wrap', async () => {
    const plan = planWithNote(
      { content: '# X\n\nSee [[notes/other|the one]].\n' },
      {
        linkPolicy: 'drop',
        inputs: [
          { relativePath: 'notes/x.md', kind: 'note', content: '# X\n\nSee [[notes/other|the one]].\n', frontmatter: {}, title: 'X' },
          { relativePath: 'notes/other.md', kind: 'note', content: '', frontmatter: {}, title: 'Other' },
        ],
      },
    );
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    // Display text preserved, no <a> / <em> around it.
    expect(html).toContain('See the one.');
    expect(html).not.toContain('<a href');
    // 'drop' doesn't wrap in <em> either — the display text is plain.
    expect(html).not.toContain('<em>the one</em>');
  });

  it('[[cite::…]] renders as a stub rather than leaking into the output', async () => {
    const plan = planWithNote({ content: '# X\n\nAs [[cite::smith-2023]] says.\n' });
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('class="cite-stub"');
    expect(html).toContain('smith-2023');
    expect(html).not.toContain('[[cite::');
  });

  it('syntax-highlights fenced code blocks inline (no external assets)', async () => {
    const plan = planWithNote({
      content: '# X\n\n```js\nconst a = 1;\n```\n',
    });
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('class="hljs language-js"');
    // hljs tokens are emitted as spans with class names; check one common one.
    expect(html).toMatch(/<span class="hljs-/);
  });

  it('tables render', async () => {
    const plan = planWithNote({
      content: '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    });
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('footnotes render via markdown-it-footnote', async () => {
    const plan = planWithNote({
      content: '# X\n\nBody[^1].\n\n[^1]: A note.\n',
    });
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('class="footnote');
    expect(html).toContain('A note.');
  });
});

describe('noteHtmlExporter — image inlining', () => {
  let root: string;
  beforeEach(async () => {
    root = mkTempProject();
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
  });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('inlines a sibling PNG as base64 when assetPolicy is inline-base64', async () => {
    // Minimal valid PNG (1x1 red pixel).
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c62f800000000010001777c3e90000000049454e44ae426082',
      'hex',
    );
    await fsp.writeFile(path.join(root, 'notes/pixel.png'), png);
    const content = '# X\n\n![pixel](pixel.png)\n';
    const plan: ExportPlan = {
      inputKind: 'single-note',
      inputs: [{ relativePath: 'notes/x.md', kind: 'note', content, frontmatter: {}, title: 'X' }],
      excluded: [],
      linkPolicy: 'inline-title',
      assetPolicy: 'inline-base64',
      rootPath: root,
    };
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    expect(html).toMatch(/src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
    expect(html).not.toContain('src="pixel.png"');
  });

  it('leaves images alone when assetPolicy is keep-relative', async () => {
    const plan: ExportPlan = {
      inputKind: 'single-note',
      inputs: [{
        relativePath: 'notes/x.md', kind: 'note',
        content: '![pixel](pixel.png)\n', frontmatter: {}, title: 'X',
      }],
      excluded: [],
      linkPolicy: 'inline-title',
      assetPolicy: 'keep-relative',
      rootPath: root,
    };
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('src="pixel.png"');
  });

  it('leaves http(s) images alone even with inline-base64', async () => {
    const plan: ExportPlan = {
      inputKind: 'single-note',
      inputs: [{
        relativePath: 'notes/x.md', kind: 'note',
        content: '![remote](https://example.org/img.png)\n', frontmatter: {}, title: 'X',
      }],
      excluded: [],
      linkPolicy: 'inline-title',
      assetPolicy: 'inline-base64',
      rootPath: root,
    };
    const output = await noteHtmlExporter.run(plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('src="https://example.org/img.png"');
  });
});

describe('noteHtmlExporter — through the pipeline', () => {
  let root: string;
  beforeEach(() => { root = mkTempProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('resolvePlan populates rootPath so image inlining can read from disk', async () => {
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes/a.md'), '# A\n\n![x](../pixel.png)\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'notes/a.md' });
    expect(plan.rootPath).toBe(root);
    // Run should not throw even though the image is missing — renderer
    // leaves src unchanged for unreadable assets.
    const output = await runExporter(noteHtmlExporter, { ...plan, assetPolicy: 'inline-base64' });
    expect(output.files).toHaveLength(1);
  });
});
