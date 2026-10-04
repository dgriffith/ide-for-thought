/**
 * Annotated-reading exporter (#253) — end-to-end through the pipeline.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { annotatedReadingExporter } from '../../../src/main/publish/exporters/annotated-reading';
import { resolveAnnotatedReading } from '../../../src/main/publish/exporters/annotated-reading/resolve';
import { renderAnnotatedReading } from '../../../src/main/publish/exporters/annotated-reading/render';

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-annot-'));
}

async function setupBrooksProject(root: string): Promise<void> {
  const sourceDir = path.join(root, '.minerva/sources/brooks-1986');
  await fsp.mkdir(sourceDir, { recursive: true });
  await fsp.writeFile(path.join(sourceDir, 'meta.ttl'),
    `this: a thought:Article ;
  dc:title "No Silver Bullet" ;
  dc:creator "Brooks, Frederick P." ;
  dc:issued "1986"^^xsd:gYear .\n`,
    'utf-8',
  );
  await fsp.writeFile(path.join(sourceDir, 'body.md'),
    '# No Silver Bullet\n\nThe essence of a software entity is a construct of interlocking concepts.\n\nFollowing Aristotle, software difficulty has two parts: essence and accidents.\n',
    'utf-8',
  );
  // Two excerpts, one of which has a tag.
  await fsp.mkdir(path.join(root, '.minerva/excerpts'), { recursive: true });
  await fsp.writeFile(path.join(root, '.minerva/excerpts/brooks-1986-essence.ttl'),
    `this: a thought:Excerpt ;
  thought:fromSource sources:brooks-1986 ;
  thought:page 11 ;
  thought:citedText "essence of a software entity is a construct of interlocking concepts" ;
  minerva:tag "essential-complexity" .\n`,
    'utf-8',
  );
  await fsp.writeFile(path.join(root, '.minerva/excerpts/brooks-1986-aristotle.ttl'),
    `this: a thought:Excerpt ;
  thought:fromSource sources:brooks-1986 ;
  thought:citedText "essence and accidents" .\n`,
    'utf-8',
  );
  // A note that links via [[quote::...]] to one excerpt + one that
  // links directly to the source.
  await fsp.writeFile(path.join(root, 'on-essence.md'),
    '---\ntitle: On Essence\n---\n# On Essence\n\nSee [[quote::brooks-1986-essence]].\n',
    'utf-8',
  );
  await fsp.writeFile(path.join(root, 'related.md'),
    '---\ntitle: Related Reading\n---\n# Related Reading\n\nSee [[brooks-1986]].\n',
    'utf-8',
  );
}

describe('annotated-reading exporter (#253)', () => {
  let root: string;
  beforeEach(async () => { root = mkProject(); await setupBrooksProject(root); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('end-to-end: emits an HTML file containing the source body + excerpt cards', async () => {
    const plan = await resolvePlan(
      root,
      { kind: 'source', relativePath: 'brooks-1986' },
      { citationStyle: 'apa' },
    );
    const output = await runExporter(annotatedReadingExporter, plan);
    expect(output.files).toHaveLength(1);
    const file = output.files[0];
    expect(file.path).toMatch(/\.html$/);
    const html = String(file.contents);
    // Source body is rendered.
    expect(html).toContain('No Silver Bullet');
    expect(html).toContain('Following Aristotle');
    // Excerpt highlights aligned to their cited passages.
    expect(html).toMatch(/<mark class="excerpt-hl"[^>]*data-excerpt="brooks-1986-essence"[^>]*>essence of a software entity/);
    expect(html).toMatch(/<mark class="excerpt-hl"[^>]*data-excerpt="brooks-1986-aristotle"[^>]*>essence and accidents/);
    // Margin pane has the citation block + a card per excerpt.
    expect(html).toContain('source-citation');
    expect(html).toContain('id="card-brooks-1986-essence"');
    expect(html).toContain('id="card-brooks-1986-aristotle"');
  });

  it('related notes (link to source generally) appear in the margin top section', async () => {
    const plan = await resolvePlan(root, { kind: 'source', relativePath: 'brooks-1986' });
    const output = await runExporter(annotatedReadingExporter, plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('class="related-notes"');
    expect(html).toContain('Related Reading');
  });

  it('linked notes (via [[quote::]]) attach to the matching excerpt card', async () => {
    const plan = await resolvePlan(root, { kind: 'source', relativePath: 'brooks-1986' });
    const output = await runExporter(annotatedReadingExporter, plan);
    const html = String(output.files[0].contents);
    // The card for the essence excerpt links to `on-essence.md`.
    expect(html).toMatch(/id="card-brooks-1986-essence"[\s\S]*?On Essence/);
    // The aristotle excerpt has no linking notes — its card has no excerpt-linked-notes ul.
    const cardMatch = html.match(/id="card-brooks-1986-aristotle"[\s\S]*?<\/article>/);
    expect(cardMatch).not.toBeNull();
    expect(cardMatch![0]).not.toContain('excerpt-linked-notes');
  });

  // Hand-added `minerva:tag` literals — the same predicate the source indexer
  // reads for user tags. Nothing Minerva writes puts tags on an excerpt, so a
  // hand-edited TTL like the fixture above is the only way they get there.
  // This read a `hasTag` in the thought namespace until #2230, a predicate
  // that exists in neither ontology — so the fixture was the only thing in
  // the world that could ever have matched it.
  it('excerpt tags render as #tags on the card', async () => {
    const plan = await resolvePlan(root, { kind: 'source', relativePath: 'brooks-1986' });
    const output = await runExporter(annotatedReadingExporter, plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('#essential-complexity');
  });

  it('excerpt with text not in the body renders unaligned with a flag', async () => {
    // Add an excerpt whose citedText doesn't appear in the body.
    await fsp.writeFile(path.join(root, '.minerva/excerpts/brooks-1986-ghost.ttl'),
      `this: a thought:Excerpt ;
  thought:fromSource sources:brooks-1986 ;
  thought:citedText "this text is not in the body anywhere" .\n`,
      'utf-8',
    );
    const plan = await resolvePlan(root, { kind: 'source', relativePath: 'brooks-1986' });
    const output = await runExporter(annotatedReadingExporter, plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('id="card-brooks-1986-ghost"');
    expect(html).toContain('class="excerpt-card unaligned"');
    expect(html).toContain("Couldn't locate this passage in the source body");
    // No <mark> highlight emitted for the unaligned one.
    expect(html).not.toMatch(/<mark[^>]*data-excerpt="brooks-1986-ghost"/);
    expect(output.summary).toContain("excerpt couldn't align");
  });

  it('summary reports counts of excerpts + related notes', async () => {
    const plan = await resolvePlan(root, { kind: 'source', relativePath: 'brooks-1986' });
    const output = await runExporter(annotatedReadingExporter, plan);
    expect(output.summary).toContain('No Silver Bullet');
    expect(output.summary).toContain('2 excerpts');
    expect(output.summary).toContain('1 related note');
  });

  it('rejects non-source export inputs', () => {
    expect(annotatedReadingExporter.accepts({ kind: 'project' })).toBe(false);
    expect(annotatedReadingExporter.accepts({ kind: 'single-note' })).toBe(false);
    expect(annotatedReadingExporter.accepts({ kind: 'tree' })).toBe(false);
    expect(annotatedReadingExporter.accepts({ kind: 'source', relativePath: 'foo' })).toBe(true);
  });
});

describe('resolveAnnotatedReading (#253) — unit', () => {
  let root: string;
  beforeEach(async () => { root = mkProject(); await setupBrooksProject(root); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('only includes excerpts whose thought:fromSource matches the source id', async () => {
    // Add an excerpt for a different source — should be ignored.
    await fsp.mkdir(path.join(root, '.minerva/sources/popper-1959'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/excerpts/popper-1959-x.ttl'),
      `this: a thought:Excerpt ;
  thought:fromSource sources:popper-1959 ;
  thought:citedText "irrelevant" .\n`,
      'utf-8',
    );
    const body = await fsp.readFile(path.join(root, '.minerva/sources/brooks-1986/body.md'), 'utf-8');
    const data = await resolveAnnotatedReading(root, 'brooks-1986', body, []);
    const ids = data.excerpts.map((e) => e.id).sort();
    expect(ids).toEqual(['brooks-1986-aristotle', 'brooks-1986-essence']);
  });

  it('surfaces excerpts even when the project has no notes (linkedNotes empty)', async () => {
    const body = await fsp.readFile(path.join(root, '.minerva/sources/brooks-1986/body.md'), 'utf-8');
    const data = await resolveAnnotatedReading(root, 'brooks-1986', body, []);
    expect(data.excerpts).toHaveLength(2);
    for (const e of data.excerpts) expect(e.linkedNotes).toEqual([]);
  });
});

describe('renderAnnotatedReading (#253) — render-layer unit', () => {
  it('reports unaligned excerpts via the return value', () => {
    const data = {
      sourceId: 'foo',
      sourceBody: 'Body with the only quotable passage right here.',
      excerpts: [
        { id: 'ex-aligned', citedText: 'quotable passage', locator: '', tags: [], linkedNotes: [] },
        { id: 'ex-unaligned', citedText: 'NOT IN BODY', locator: '', tags: [], linkedNotes: [] },
      ],
      relatedNotes: [],
    };
    const out = renderAnnotatedReading({ data, sourceTitle: 'Foo', renderer: null });
    expect(out.unalignedExcerpts).toEqual(['ex-unaligned']);
    expect(out.html).toContain('data-excerpt="ex-aligned"');
    expect(out.html).toContain('id="card-ex-unaligned"');
  });

  it('orders aligned excerpt cards by document position', () => {
    const data = {
      sourceId: 'foo',
      sourceBody: 'First passage. Some prose. Second passage. Final words.',
      excerpts: [
        // Listed in reverse document order in the input.
        { id: 'ex-second', citedText: 'Second passage', locator: '', tags: [], linkedNotes: [] },
        { id: 'ex-first', citedText: 'First passage', locator: '', tags: [], linkedNotes: [] },
      ],
      relatedNotes: [],
    };
    const out = renderAnnotatedReading({ data, sourceTitle: 'Foo', renderer: null });
    const firstIdx = out.html.indexOf('id="card-ex-first"');
    const secondIdx = out.html.indexOf('id="card-ex-second"');
    expect(firstIdx).toBeGreaterThan(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  it('emits the inline JS that powers hover/click sync', () => {
    const data = { sourceId: 'foo', sourceBody: 'x', excerpts: [], relatedNotes: [] };
    const out = renderAnnotatedReading({ data, sourceTitle: 'Foo', renderer: null });
    expect(out.html).toContain("data-excerpt");
    // Inline script registers mouseover/mouseout/click handlers.
    expect(out.html).toContain("addEventListener('mouseover'");
    expect(out.html).toContain("addEventListener('click'");
  });
});

describe('renderAnnotatedReading — a third-party source body can\'t script the export (#2558)', () => {
  /** The <article class="source-body"> part of the document, where the body lands. */
  function sourceBodyHtml(html: string): string {
    const m = html.match(/<article class="source-body">([\s\S]*?)<\/article>\s*<aside/);
    if (!m) throw new Error('no source-body article in the export');
    return m[1]!;
  }
  const excerpt = (id: string, citedText: string) => ({ id, citedText, locator: '', tags: [], linkedNotes: [] });

  it('renders raw <script> / on* HTML in the body as text, not markup', () => {
    const data = {
      sourceId: 'web',
      sourceBody: [
        'Intro paragraph with a quotable passage.',
        '',
        '<img src=x onerror=alert(1)>',
        '',
        '<script>alert(document.cookie)</script>',
        '',
        'Inline <svg onload=alert(2)> and <a href="javascript:alert(3)">x</a> too.',
      ].join('\n'),
      excerpts: [excerpt('ex1', 'quotable passage')],
      relatedNotes: [],
    };
    const { html } = renderAnnotatedReading({ data, sourceTitle: 'Web page', renderer: null });
    const body = sourceBodyHtml(html);
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/<img\b/i);
    expect(body).not.toMatch(/<svg\b/i);
    expect(body).not.toMatch(/<a\b[^>]*javascript:/i);
    // No element anywhere in the body carries an event-handler attribute.
    expect(body).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);
    // It's still all there, as visible text.
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(body).toContain('&lt;script&gt;');
    // The export's own inline script is the only <script> in the document.
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it('still highlights excerpts with <mark>, including next to escaped HTML and inside code', () => {
    const data = {
      sourceId: 'web',
      sourceBody: 'Before <b>raw</b> the cited words after.\n\n```\ncode with cited snippet\n```\n',
      excerpts: [excerpt('ex-a', 'the cited words'), excerpt('ex-b', 'cited snippet')],
      relatedNotes: [],
    };
    const { html, unalignedExcerpts } = renderAnnotatedReading({ data, sourceTitle: 'T', renderer: null });
    const body = sourceBodyHtml(html);
    expect(unalignedExcerpts).toEqual([]);
    expect(body).toContain('<mark class="excerpt-hl" data-excerpt="ex-a">the cited words</mark>');
    expect(body).toContain('<mark class="excerpt-hl" data-excerpt="ex-b">cited snippet</mark>');
    expect(body).toContain('&lt;b&gt;raw&lt;/b&gt;');
  });

  it('a body can\'t forge a highlight with the private-use sentinels', () => {
    const data = {
      sourceId: 'web',
      sourceBody: 'Forged 0 opener and closer  here; real passage.',
      excerpts: [excerpt('ex-real', 'real passage')],
      relatedNotes: [],
    };
    const { html } = renderAnnotatedReading({ data, sourceTitle: 'T', renderer: null });
    const body = sourceBodyHtml(html);
    expect(body.match(/<mark /g)).toHaveLength(1);
    expect(body.match(/<\/mark>/g)).toHaveLength(1);
    expect(body).toContain('<mark class="excerpt-hl" data-excerpt="ex-real">real passage</mark>');
    expect(body).not.toMatch(/[-]/);
  });

  it('escapes an excerpt id in the generated <mark>', () => {
    const data = {
      sourceId: 'web',
      sourceBody: 'the passage',
      excerpts: [excerpt('x"><script>alert(1)</script>', 'passage')],
      relatedNotes: [],
    };
    const body = sourceBodyHtml(renderAnnotatedReading({ data, sourceTitle: 'T', renderer: null }).html);
    expect(body).not.toMatch(/<script/i);
  });
});
