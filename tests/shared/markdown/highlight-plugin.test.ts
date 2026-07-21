/**
 * Markdown-it `==text==` / `==color:text==` highlight plugin (#468).
 */

import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { installHighlight, scanHighlights } from '../../../src/shared/markdown/highlight-plugin';

function md(): MarkdownIt {
  const m = new MarkdownIt({ html: true });
  installHighlight(m);
  return m;
}

describe('highlight plugin (#468)', () => {
  // ─── baseline ==text== ──────────────────────────────────────────────

  it('renders ==text== as <mark class="hl">', () => {
    expect(md().render('Hello ==world==!')).toContain('<mark class="hl">world</mark>');
  });

  it('renders multiple highlights in one paragraph', () => {
    const html = md().render('==one== then ==two==');
    expect(html.match(/<mark class="hl">/g)).toHaveLength(2);
    expect(html).toContain('>one</mark>');
    expect(html).toContain('>two</mark>');
  });

  // ─── colored variants ──────────────────────────────────────────────

  it('renders ==yellow:text== with hl-yellow class', () => {
    const html = md().render('A ==yellow:warning== sign');
    expect(html).toMatch(/<mark[^>]*class="hl hl-yellow"[^>]*>warning<\/mark>/);
  });

  it.each(['yellow', 'green', 'blue', 'pink', 'orange'])(
    'recognises the %s palette color',
    (color) => {
      const html = md().render(`==${color}:body==`);
      expect(html).toMatch(new RegExp(`<mark[^>]*class="hl hl-${color}"[^>]*>body</mark>`));
    },
  );

  it('falls back to uncolored when the prefix is not a palette color', () => {
    // `Pythagorean:` looks like a color prefix but isn't in the palette
    // — the whole content stays in the body.
    const html = md().render('==Pythagorean: a²+b²==');
    expect(html).toContain('<mark class="hl">Pythagorean: a²+b²</mark>');
    expect(html).not.toContain('hl-');
  });

  it('keeps a bare palette word as the body when there is no `:`', () => {
    // `==yellow==` is just the word "yellow" highlighted, not a colored
    // empty body.
    expect(md().render('==yellow==')).toContain('<mark class="hl">yellow</mark>');
  });

  // ─── recursive tokenisation ───────────────────────────────────────

  it('lets emphasis render inside a highlight', () => {
    const html = md().render('==yellow:**bold** highlight==');
    expect(html).toMatch(/<mark[^>]*class="hl hl-yellow"/);
    expect(html).toContain('<strong>bold</strong>');
  });

  it('does not eat the opening when inline code lives inside', () => {
    // The body `code spans don't eat ==` should pass through; the
    // closing `==` after lives in normal text and should still pair
    // up with the opener.
    const html = md().render('text ==hl with `code`== end');
    expect(html).toContain('<mark class="hl">hl with <code>code</code></mark>');
  });

  // ─── rejection cases ──────────────────────────────────────────────

  it('does not match `=== … ===` (heading-rule territory)', () => {
    const html = md().render('===not a highlight===');
    expect(html).not.toContain('<mark');
  });

  it('spans a soft newline within a paragraph (like strong/em)', () => {
    const html = md().render('==open\nand closed on the next line==');
    expect(html).toContain('<mark');
    expect(html).toContain('open\nand closed on the next line');
  });

  it('does not reach across a blank line (paragraph boundary)', () => {
    const html = md().render('==open\n\nclosed after a blank line==');
    expect(html).not.toContain('<mark');
  });

  it('spans multiple soft newlines but stops at the paragraph', () => {
    // Whole three-line paragraph highlights; the following paragraph is untouched.
    const html = md().render('==a\nb\nc==\n\nplain ==d== tail');
    expect(html).toContain('<mark class="hl">a\nb\nc</mark>');
    expect(html).toContain('<mark class="hl">d</mark>');
  });

  it('rejects whitespace-padded bodies (== test ==)', () => {
    // Mirrors strong/em — keeps prose from accidentally highlighting.
    expect(md().render('== test ==')).not.toContain('<mark');
  });

  it('rejects empty bodies (====)', () => {
    expect(md().render('====')).not.toContain('<mark');
  });

  it('leaves the syntax alone inside a code span', () => {
    // `` ` `` opens a code span; the `==…==` inside is literal.
    const html = md().render('Use `==text==` for highlights.');
    expect(html).toContain('<code>==text==</code>');
    expect(html).not.toContain('<mark');
  });

  it('leaves the syntax alone inside a fenced code block', () => {
    const html = md().render('```\n==in a fence==\n```\n');
    expect(html).not.toContain('<mark');
    expect(html).toContain('==in a fence==');
  });

  // ─── attributes ────────────────────────────────────────────────────

  it('emits a data-hl-color attribute for colored variants', () => {
    // Useful for the editor's source-mode decoration parity and for
    // print stylesheets that need to round-trip the color.
    expect(md().render('==green:passing==')).toContain('data-hl-color="green"');
  });

  it('omits data-hl-color for the uncolored default', () => {
    expect(md().render('==default==')).not.toContain('data-hl-color');
  });
});

describe('scanHighlights (editor decoration shared scanner)', () => {
  it('returns one match per ==…== span with absolute offsets', () => {
    const text = 'Hello ==world== and ==yellow:bye==!';
    const out = scanHighlights(text);
    expect(out).toEqual([
      { from: 6,  to: 15, color: null },
      { from: 20, to: 34, color: 'yellow' },
    ]);
  });

  it('honours the offset argument so callers can pass viewport slices', () => {
    expect(scanHighlights('==x==', 100)).toEqual([{ from: 100, to: 105, color: null }]);
  });

  it('skips `===` runs', () => {
    expect(scanHighlights('===nope=== and ===yep===')).toEqual([]);
  });

  it('spans a single newline', () => {
    expect(scanHighlights('==open\nclose==')).toEqual([{ from: 0, to: 14, color: null }]);
  });

  it('stops at a blank line (paragraph boundary)', () => {
    // The span across the blank line never closes, so nothing matches here;
    // a self-contained highlight in the second paragraph still does.
    expect(scanHighlights('==open\n\nclose==')).toEqual([]);
    expect(scanHighlights('==a\nb==\n\n==c==')).toEqual([
      { from: 0, to: 7, color: null },
      { from: 9, to: 14, color: null },
    ]);
  });

  it('stops at a whitespace-only line, not just a bare blank line', () => {
    expect(scanHighlights('==open\n   \nclose==')).toEqual([]);
  });

  it('rejects whitespace-padded bodies', () => {
    expect(scanHighlights('== test ==')).toEqual([]);
  });

  it('matches every palette color', () => {
    const colors = ['yellow', 'green', 'blue', 'pink', 'orange'] as const;
    for (const c of colors) {
      const r = scanHighlights(`==${c}:b==`);
      expect(r).toHaveLength(1);
      expect(r[0].color).toBe(c);
    }
  });

  it('falls back to uncolored when prefix is not a palette color', () => {
    expect(scanHighlights('==Pythagorean: a²+b²==')[0].color).toBe(null);
  });
});
