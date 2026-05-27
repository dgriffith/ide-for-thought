/**
 * DOI auto-link markdown-it plugin (#473).
 */

import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { installDoiAutolink } from '../../../src/shared/markdown/doi-plugin';

function md(): MarkdownIt {
  const m = new MarkdownIt({ html: true, linkify: true });
  installDoiAutolink(m);
  return m;
}

describe('doi-plugin: bare DOI auto-link', () => {
  it('wraps a standalone DOI in a doi.org link', () => {
    const html = md().render('See 10.1145/3677999.3678002 for details.');
    expect(html).toContain('<a href="https://doi.org/10.1145/3677999.3678002">10.1145/3677999.3678002</a>');
  });

  it('does not eat a trailing period at end-of-sentence', () => {
    const html = md().render('See 10.1145/3677999.3678002.');
    // The DOI body lives inside the anchor, the period stays outside.
    expect(html).toContain('href="https://doi.org/10.1145/3677999.3678002"');
    expect(html).toContain('>10.1145/3677999.3678002</a>.');
  });

  it('does not eat trailing punctuation other than period', () => {
    const html = md().render('Cite 10.1234/foo, then 10.5678/bar; finally 10.9999/baz)');
    expect(html).toContain('>10.1234/foo</a>,');
    expect(html).toContain('>10.5678/bar</a>;');
    expect(html).toContain('>10.9999/baz</a>)');
  });

  it('handles multiple DOIs in one paragraph', () => {
    const html = md().render('10.1234/a and 10.5678/b');
    const matches = html.match(/href="https:\/\/doi\.org\/[^"]+"/g);
    expect(matches).toEqual([
      'href="https://doi.org/10.1234/a"',
      'href="https://doi.org/10.5678/b"',
    ]);
  });

  it('does not link non-DOI numbers that happen to start with 10.', () => {
    const html = md().render('10.4 of the spec, or 10.42% of users.');
    expect(html).not.toContain('doi.org');
  });

  it('leaves linkify-handled DOI URLs alone', () => {
    // linkify turns the URL into a link before our rule fires;
    // we shouldn't double-wrap the DOI portion.
    const html = md().render('See https://doi.org/10.1234/foo.');
    expect(html).toContain('<a href="https://doi.org/10.1234/foo">');
    // No nested anchor inside the linkify-produced anchor.
    expect(html).not.toMatch(/<a[^>]*><a/);
  });

  it('handles a DOI inside a sentence with surrounding text', () => {
    const html = md().render('Before 10.1234/foo after.');
    expect(html).toContain('Before <a href="https://doi.org/10.1234/foo">10.1234/foo</a> after.');
  });

  it('does not break inside code spans', () => {
    const html = md().render('`10.1234/foo` should stay raw');
    expect(html).toContain('<code>10.1234/foo</code>');
    expect(html).not.toMatch(/<code>[^<]*doi\.org/);
  });

  it('does not break inside fenced code blocks', () => {
    const html = md().render('```\n10.1234/foo\n```');
    expect(html).not.toContain('doi.org');
  });

  it('preserves the inner DOI text verbatim', () => {
    // No url-encoding inside the visible link text — what the user
    // sees matches what's on the page.
    const html = md().render('10.1234/under_score-dot.in-suffix');
    expect(html).toContain('>10.1234/under_score-dot.in-suffix</a>');
  });
});
