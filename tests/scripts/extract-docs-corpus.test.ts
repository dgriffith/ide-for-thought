import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error -- plain JS build-time module, no .d.ts
import {
  extractPageChunks as extractPageChunksImpl,
  extractFragmentChunks as extractFragmentChunksImpl,
  extractDocsCorpus as extractDocsCorpusImpl,
} from '../../scripts/lib/extract-docs-corpus.mjs';

interface DocChunk {
  id: string;
  sourcePage: string;
  pageTitle: string;
  heading: string;
  text: string;
}

const extractPageChunks = extractPageChunksImpl as (
  html: string,
  sourcePage: string,
  opts?: { maxChars?: number },
) => DocChunk[];
const extractFragmentChunks = extractFragmentChunksImpl as (
  body: string,
  sourcePage: string,
  opts?: { maxChars?: number },
) => DocChunk[];
const extractDocsCorpus = extractDocsCorpusImpl as (docsDir: string, opts?: { maxChars?: number }) => DocChunk[];

const PAGE_SHELL = (main: string) => `<!DOCTYPE html>
<html lang="en">
<head><title>Test</title></head>
<body>
<nav>Decoy nav content — should never appear in a chunk.</nav>
<div class="docs">
  <aside class="docs-nav">Decoy sidebar content — should never appear in a chunk.</aside>
  <main class="docs-content">
${main}
  </main>
</div>
<footer>Decoy footer content — should never appear in a chunk.</footer>
</body>
</html>`;

describe('extractPageChunks', () => {
  it('captures the h1 + lede preamble as its own chunk with a bare page id', () => {
    const html = PAGE_SHELL(`
      <p class="crumbs">Decoy crumb — should never appear in a chunk.</p>
      <h1>Widgets</h1>
      <p class="lede">Widgets do the thing.</p>
      <h2 id="basics">Basics</h2>
      <p>Basic body.</p>
    `);
    const chunks = extractPageChunks(html, 'widgets.html');
    const preamble = chunks.find((c: DocChunk) => c.id === 'widgets.html');
    expect(preamble).toBeTruthy();
    expect(preamble!.heading).toBe('');
    expect(preamble!.pageTitle).toBe('Widgets');
    expect(preamble!.text).toBe('Widgets do the thing.');
  });

  it('chunks each h2 section under a page.html#anchor id', () => {
    const html = PAGE_SHELL(`
      <h1>Widgets</h1>
      <p class="lede">Lede.</p>
      <h2 id="basics">Basics</h2>
      <p>Basic body.</p>
      <h2 id="advanced">Advanced</h2>
      <p>Advanced body.</p>
    `);
    const chunks = extractPageChunks(html, 'widgets.html');
    const ids = chunks.map((c: DocChunk) => c.id);
    expect(ids).toEqual(['widgets.html', 'widgets.html#basics', 'widgets.html#advanced']);
    expect(chunks[1].heading).toBe('Basics');
    expect(chunks[1].text).toBe('Basic body.');
    expect(chunks[2].heading).toBe('Advanced');
    expect(chunks[2].text).toBe('Advanced body.');
  });

  it('falls back to a slugified id when an h2 has none', () => {
    const html = PAGE_SHELL(`
      <h1>Widgets</h1>
      <p class="lede">Lede.</p>
      <h2>No Id Here!</h2>
      <p>Body.</p>
    `);
    const chunks = extractPageChunks(html, 'widgets.html');
    expect(chunks[1].id).toBe('widgets.html#no-id-here');
  });

  it('expands a .deflist into one piece per row, not one opaque blob', () => {
    const html = PAGE_SHELL(`
      <h1>Widgets</h1>
      <p class="lede">Lede.</p>
      <h2 id="types">Types</h2>
      <div class="deflist">
        <div class="row"><div class="k">alpha</div><div class="v">The alpha type.</div></div>
        <div class="row"><div class="k">beta</div><div class="v">The beta type.</div></div>
      </div>
    `);
    const chunks = extractPageChunks(html, 'widgets.html');
    const section = chunks.filter((c: DocChunk) => c.id === 'widgets.html#types');
    // Both rows fit comfortably under maxChars, so they land in one chunk —
    // but joined with a paragraph break, not flattened into one run-on string.
    expect(section).toHaveLength(1);
    expect(section[0].text).toContain('alpha The alpha type.');
    expect(section[0].text).toContain('beta The beta type.');
    expect(section[0].text).toMatch(/alpha The alpha type\.\n\nbeta The beta type\./);
  });

  it('expands .doc-cards and <ul>/<ol> into per-item pieces the same way', () => {
    const html = PAGE_SHELL(`
      <h1>Hub</h1>
      <p class="lede">Lede.</p>
      <h2 id="cards">Cards</h2>
      <div class="doc-cards">
        <a class="doc-card" href="a.html"><h3>A</h3><p>About A.</p></a>
        <a class="doc-card" href="b.html"><h3>B</h3><p>About B.</p></a>
      </div>
      <h2 id="list">List</h2>
      <ul>
        <li>First gotcha.</li>
        <li>Second gotcha.</li>
      </ul>
    `);
    const chunks = extractPageChunks(html, 'hub.html');
    const cards = chunks.find((c: DocChunk) => c.id === 'hub.html#cards')!;
    expect(cards.text).toContain('A About A.');
    expect(cards.text).toContain('B About B.');
    const list = chunks.find((c: DocChunk) => c.id === 'hub.html#list')!;
    expect(list.text).toBe('First gotcha.\n\nSecond gotcha.');
  });

  it('excludes nav/aside/footer chrome and in-main .crumbs/.pager/.shot noise', () => {
    const html = PAGE_SHELL(`
      <p class="crumbs">Decoy crumb — should never appear in a chunk.</p>
      <h1>Widgets</h1>
      <p class="lede">Lede.</p>
      <h2 id="basics">Basics</h2>
      <p>Real body text.</p>
      <div class="shot wide">
        <div class="icon">🔧</div>
        <div class="k">Screenshot — Basics</div>
        <div class="d">Decoy screenshot caption — should never appear in a chunk.</div>
      </div>
      <div class="pager">Decoy pager — should never appear in a chunk.</div>
    `);
    const chunks = extractPageChunks(html, 'widgets.html');
    const allText = chunks.map((c: DocChunk) => c.text).join(' ');
    expect(allText).toContain('Real body text.');
    for (const decoy of ['Decoy nav', 'Decoy sidebar', 'Decoy footer', 'Decoy crumb', 'Decoy screenshot caption', 'Decoy pager']) {
      expect(allText).not.toContain(decoy);
    }
  });

  it('returns no chunks for a page with no main.docs-content (defensive)', () => {
    expect(extractPageChunks('<html><body>no main here</body></html>', 'weird.html')).toEqual([]);
  });

  it('splits an over-long section by packing whole rows/sentences, never mid-word', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      `<div class="row"><div class="k">type-${i}</div><div class="v">A fairly descriptive explanation of type number ${i} and what it is used for in practice, written out at reasonable length.</div></div>`,
    ).join('\n');
    const html = PAGE_SHELL(`
      <h1>Widgets</h1>
      <p class="lede">Lede.</p>
      <h2 id="types">Types</h2>
      <div class="deflist">${rows}</div>
    `);
    const chunks = extractPageChunks(html, 'widgets.html', { maxChars: 300 });
    const section = chunks.filter((c: DocChunk) => c.id === 'widgets.html#types');
    expect(section.length).toBeGreaterThan(1);
    for (const chunk of section) {
      expect(chunk.text.length).toBeLessThanOrEqual(300);
      // No hard mid-word cut: every piece boundary should read as one or more
      // complete "key value" rows, never truncated mid-token.
      expect(chunk.text.trim()).toMatch(/^type-\d+ .*[.]$/s);
    }
  });

  it('hard-slices only as a last resort, for a single sentence longer than maxChars', () => {
    const longSentence = 'x'.repeat(50) + ' word '.repeat(50) + 'end.';
    // The extractor collapses whitespace the same way the browser's own
    // `.textContent` reads it, so the expected value is normalized the same
    // way rather than compared against the raw double-spaced input literal.
    const normalized = longSentence.replace(/\s+/g, ' ').trim();
    const html = PAGE_SHELL(`
      <h1>Widgets</h1>
      <p class="lede">Lede.</p>
      <h2 id="basics">Basics</h2>
      <p>${longSentence}</p>
    `);
    const chunks = extractPageChunks(html, 'widgets.html', { maxChars: 50 });
    const section = chunks.filter((c: DocChunk) => c.id === 'widgets.html#basics');
    expect(section.length).toBeGreaterThan(1);
    // Reassembling the pieces recovers the original text losslessly.
    expect(section.map((c: DocChunk) => c.text).join('')).toBe(normalized);
  });
});

describe('extractFragmentChunks', () => {
  it('reads a bare content fragment — no chrome to scope past (#1842)', () => {
    const chunks = extractFragmentChunks(
      '<h1>Widgets</h1>\n<p class="lede">All about widgets.</p>\n<h2 id="making">Making one</h2>\n<p>Press the button.</p>',
      'widgets.html',
    );
    expect(chunks.map((c: DocChunk) => [c.id, c.text])).toEqual([
      ['widgets.html', 'All about widgets.'],
      ['widgets.html#making', 'Press the button.'],
    ]);
    expect(chunks[0].pageTitle).toBe('Widgets');
  });

  it('produces the same chunks as the generated page it renders to', () => {
    const body = '<h1>Widgets</h1>\n<p class="lede">All about widgets.</p>\n<h2 id="making">Making one</h2>\n<p>Press the button.</p>';
    const page = PAGE_SHELL(
      `    <p class="crumbs"><a href="index.html">Docs</a>/Widgets</p>\n${body}\n    <div class="pager"><a class="next" href="x.html">Next</a></div>`,
    );
    expect(extractFragmentChunks(body, 'widgets.html')).toEqual(extractPageChunks(page, 'widgets.html'));
  });
});

describe('extractDocsCorpus', () => {
  let dir: string;

  beforeAll(() => {
    // The real shape: fragments in `<docsDir>/_content`, one per page.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-corpus-test-'));
    const content = path.join(dir, '_content');
    fs.mkdirSync(content);
    const fragment = (letter: string, id: string) =>
      `---\ntitle: ${letter}\ndescription: Page ${letter}.\n---\n\n<h1>${letter}</h1><p class="lede">Lede ${letter}.</p><h2 id="${id}">${id.toUpperCase()}</h2><p>Body ${letter}.</p>\n`;
    fs.writeFileSync(path.join(content, 'a.html'), fragment('A', 'x'));
    fs.writeFileSync(path.join(content, 'b.html'), fragment('B', 'y'));
    // A non-html file must be ignored, and so must the generated pages
    // sitting alongside `_content` in the docs dir.
    fs.writeFileSync(path.join(content, 'notes.txt'), 'not a fragment');
    fs.writeFileSync(path.join(dir, 'docs.css'), 'body { color: red; }');
    fs.writeFileSync(path.join(dir, 'a.html'), PAGE_SHELL('<h1>Stale</h1><p class="lede">Should never be read.</p>'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('aggregates chunks across every content fragment, ignoring everything else', () => {
    const chunks = extractDocsCorpus(dir);
    const sourcePages = [...new Set(chunks.map((c: DocChunk) => c.sourcePage))].sort();
    expect(sourcePages).toEqual(['a.html', 'b.html']);
    expect(chunks.some((c: DocChunk) => c.text === 'Lede A.')).toBe(true);
    expect(chunks.some((c: DocChunk) => c.text === 'Lede B.')).toBe(true);
    expect(chunks.some((c: DocChunk) => c.text === 'Should never be read.')).toBe(false);
  });
});
