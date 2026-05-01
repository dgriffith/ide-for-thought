/**
 * Clean-markdown exporter (#250).
 *
 * Verifies the rewrites that turn Minerva-internal markdown into
 * markdown that renders correctly outside Minerva (paste into GitHub,
 * Substack, Hugo, etc.).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { noteMarkdownExporter } from '../../../src/main/publish/exporters/note-markdown';

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-md-export-'));
}

describe('clean-markdown exporter (#250)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkProject();
    await fsp.mkdir(path.join(root, '.minerva/sources/toulmin-1958'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/toulmin-1958/meta.ttl'),
      `this: a thought:Book ;
  dc:title "The Uses of Argument" ;
  dc:creator "Toulmin, Stephen" ;
  dc:issued "1958"^^xsd:gYear .\n`,
      'utf-8',
    );
    await fsp.mkdir(path.join(root, '.minerva/excerpts'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/excerpts/ex-toulmin.ttl'),
      `this: a thought:Excerpt ;
  thought:fromSource sources:toulmin-1958 ;
  thought:page 11 .\n`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('rewrites wiki-links via inline-title and removes [[ tokens', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '# Heading\n\nSee [[other]] and [[notes/deep]].\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'other.md'),
      '---\ntitle: The Other\n---\n# The Other\n', 'utf-8');
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes/deep.md'),
      '---\ntitle: Deep Thoughts\n---\n# Deep Thoughts\n', 'utf-8');

    const plan = await resolvePlan(
      root,
      { kind: 'project' },
      { linkPolicy: 'inline-title' },
    );
    const output = await runExporter(noteMarkdownExporter, plan);
    const aFile = output.files.find((f) => f.path === 'a.md');
    expect(aFile).toBeDefined();
    const text = String(aFile!.contents);
    expect(text).not.toContain('[[');
    expect(text).toContain('The Other');
    expect(text).toContain('Deep Thoughts');
  });

  it('renders [[cite::id]] as plain-text in-text mark + appends ## References', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '# A\n\nAs [[cite::toulmin-1958]] showed.\n', 'utf-8');
    const plan = await resolvePlan(
      root,
      { kind: 'single-note', relativePath: 'a.md' },
      { citationStyle: 'apa' },
    );
    const output = await runExporter(noteMarkdownExporter, plan);
    const text = String(output.files[0].contents);

    // In-text mark contains the author + year, no HTML wrappers.
    expect(text).toMatch(/Toulmin, 1958/);
    expect(text).not.toContain('<i>');
    expect(text).not.toContain('<span');
    // References footer.
    expect(text).toContain('## References');
    // Bibliography entry shows as a markdown bullet, not an HTML <li>.
    expect(text).toMatch(/^- Toulmin/m);
    // No raw [[cite::]] left over.
    expect(text).not.toContain('[[cite::');
  });

  it('renders [[quote::id]] with a page locator from the excerpt', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      'See [[quote::ex-toulmin]] for the foundations.\n', 'utf-8');
    const plan = await resolvePlan(
      root,
      { kind: 'single-note', relativePath: 'a.md' },
      { citationStyle: 'apa' },
    );
    const output = await runExporter(noteMarkdownExporter, plan);
    const text = String(output.files[0].contents);
    expect(text).toContain('Toulmin');
    expect(text).toContain('11'); // the excerpt's page locator
    expect(text).not.toContain('[[quote::');
  });

  it('Chicago full-note → [^N] footnote markers + Pandoc footnote definitions', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '# A\n\nFirst [[cite::toulmin-1958]] cite.\n', 'utf-8');
    const plan = await resolvePlan(
      root,
      { kind: 'single-note', relativePath: 'a.md' },
      { citationStyle: 'chicago-notes-bibliography' },
    );
    const output = await runExporter(noteMarkdownExporter, plan);
    const text = String(output.files[0].contents);
    expect(text).toContain('[^1]');
    // Pandoc-style footnote definition somewhere after the body.
    expect(text).toMatch(/\n\[\^1\]: .*Toulmin/);
    // No <sup> HTML markup leaking in (text mode).
    expect(text).not.toContain('<sup');
  });

  it('drops embedded ```turtle blocks (not portable markdown)', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '# A\n\nProse.\n\n```turtle\n@prefix ex: <http://example.com/> .\nex:foo a ex:Bar .\n```\n\nMore prose.\n',
      'utf-8',
    );
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'a.md' });
    const output = await runExporter(noteMarkdownExporter, plan);
    const text = String(output.files[0].contents);
    expect(text).not.toContain('```turtle');
    expect(text).not.toContain('@prefix');
    expect(text).toContain('Prose.');
    expect(text).toContain('More prose.');
  });

  it('preserves other fence languages (python / sparql / sql)', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '```python\nprint("hi")\n```\n\n```sparql\nSELECT * WHERE { ?s ?p ?o }\n```\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'a.md' });
    const output = await runExporter(noteMarkdownExporter, plan);
    const text = String(output.files[0].contents);
    expect(text).toContain('```python');
    expect(text).toContain('print("hi")');
    expect(text).toContain('```sparql');
    expect(text).toContain('SELECT *');
  });

  it('does not rewrite [[cite::]] inside fenced code blocks (example syntax)', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      'Real cite: [[cite::toulmin-1958]].\n\n```\nExample syntax: [[cite::brooks-1986]]\n```\n', 'utf-8');
    const plan = await resolvePlan(
      root,
      { kind: 'single-note', relativePath: 'a.md' },
      { citationStyle: 'apa' },
    );
    const output = await runExporter(noteMarkdownExporter, plan);
    const text = String(output.files[0].contents);
    // Real cite outside the fence got rendered.
    expect(text).toContain('Toulmin');
    // Example syntax inside the fence stays raw.
    expect(text).toContain('[[cite::brooks-1986]]');
  });

  it('omits ## References when no citations fired', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '# A\n\nJust prose.\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'a.md' });
    const output = await runExporter(noteMarkdownExporter, plan);
    const text = String(output.files[0].contents);
    expect(text).not.toContain('## References');
  });

  it('preserves frontmatter verbatim (passes through to the output)', async () => {
    await fsp.writeFile(path.join(root, 'a.md'),
      '---\ntitle: My Note\ntags: [foo, bar]\n---\n\n# My Note\n\nbody\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'a.md' });
    const output = await runExporter(noteMarkdownExporter, plan);
    const text = String(output.files[0].contents);
    expect(text).toMatch(/^---\ntitle: My Note\ntags: \[foo, bar\]\n---/);
  });

  it('flattens single-note path: notes/foo/bar.md → bar.md at output root', async () => {
    await fsp.mkdir(path.join(root, 'notes/foo'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes/foo/bar.md'), '# Bar\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'notes/foo/bar.md' });
    const output = await runExporter(noteMarkdownExporter, plan);
    expect(output.files[0].path).toBe('bar.md');
  });

  it('preserves source tree at folder/project scope so follow-to-file links resolve', async () => {
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes/a.md'), '# A\n[[notes/b]]\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'notes/b.md'), '# B\n', 'utf-8');
    const plan = await resolvePlan(
      root,
      { kind: 'project' },
      { linkPolicy: 'follow-to-file' },
    );
    const output = await runExporter(noteMarkdownExporter, plan);
    const paths = output.files.map((f) => f.path).sort();
    expect(paths).toEqual(['notes/a.md', 'notes/b.md']);
    const a = String(output.files.find((f) => f.path === 'notes/a.md')!.contents);
    expect(a).toContain('[B](notes/b.md)');
  });

  it('exporter exposes the expected id and label for the registry', () => {
    expect(noteMarkdownExporter.id).toBe('note-markdown');
    expect(noteMarkdownExporter.label).toBe('Note as Clean Markdown');
    expect(noteMarkdownExporter.acceptedKinds).toEqual(['single-note', 'folder', 'project']);
    expect(noteMarkdownExporter.accepts({ kind: 'tree' })).toBe(false);
    expect(noteMarkdownExporter.accepts({ kind: 'single-note' })).toBe(true);
  });
});
