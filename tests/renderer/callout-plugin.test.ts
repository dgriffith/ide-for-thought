import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { installCallouts } from '../../src/renderer/lib/markdown/callout-plugin';

function md(): MarkdownIt {
  const m = new MarkdownIt({ html: true });
  // Mirror Preview.svelte: setext headings are disabled so a `[!card]` front
  // plus a `---` divider doesn't parse as an `<h2>` underline (#850).
  m.disable('lheading');
  installCallouts(m);
  return m;
}

describe('callout-plugin: basic rendering', () => {
  it('renders a [!note] blockquote as a callout div', () => {
    const html = md().render('> [!note]\n> Body.\n');
    expect(html).toContain('class="callout callout-note"');
    expect(html).toContain('data-callout="note"');
    expect(html).toContain('class="callout-title-text">Note<');
    expect(html).toContain('class="callout-content"');
    expect(html).toContain('Body.');
  });

  it('uses the type-default title when no custom title is given', () => {
    const html = md().render('> [!warning]\n> Watch out.\n');
    expect(html).toContain('Warning');
    expect(html).toContain('callout-warning');
  });

  it('uses a custom title after the marker', () => {
    const html = md().render('> [!info] Pay attention\n> Body.\n');
    expect(html).toContain('Pay attention');
    expect(html).not.toMatch(/class="callout-title-text">Info</);
  });

  it('lowercases the type and tags unknown types as "unknown"', () => {
    const html = md().render('> [!CUSTOMTYPE]\n> body\n');
    expect(html).toContain('callout-unknown');
    expect(html).toContain('data-callout="customtype"');
  });

  it('falls back to plain blockquote when the marker is absent', () => {
    const html = md().render('> just a quote\n');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('callout');
  });
});

describe('callout-plugin: collapsible variants', () => {
  it('+ marker renders as an open <details>', () => {
    const html = md().render('> [!tip]+ Tap me\n> body\n');
    expect(html).toContain('<details');
    expect(html).toContain(' open');
    expect(html).toContain('callout-collapsible');
    expect(html).toContain('<summary class="callout-title">');
  });

  it('- marker renders as a closed <details>', () => {
    const html = md().render('> [!info]- Hidden\n> body\n');
    expect(html).toContain('<details');
    expect(html).not.toContain(' open');
    expect(html).toContain('callout-collapsible');
  });

  it('no fold marker renders as a <div> (non-collapsible)', () => {
    const html = md().render('> [!note]\n> body\n');
    expect(html).toContain('<div class="callout');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('callout-collapsible');
  });
});

describe('callout-plugin: marker stripping', () => {
  it('drops the marker line when nothing else is on it', () => {
    const html = md().render('> [!note]\n> Just the body.\n');
    expect(html).not.toContain('[!note]');
    expect(html).toContain('Just the body.');
  });

  it('keeps inline-formatted body content after the title line', () => {
    const html = md().render('> [!note] Title\n> Body with **bold** text.\n');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('Body with');
  });

  it('renders body text exactly once (regression: pre-tokenizing inline.children doubled output)', () => {
    const html = md().render('> [!note]\n> Body.\n');
    const occurrences = html.split('Body.').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('callout-plugin: bare paragraph form (lenient extension)', () => {
  it('renders [!type] without a leading > as a callout too', () => {
    const html = md().render('[!note]\nBody of the callout.\n');
    expect(html).toContain('class="callout callout-note"');
    expect(html).toContain('Body of the callout.');
  });

  it('plain paragraphs are unaffected', () => {
    const html = md().render('Just a normal paragraph.\n');
    expect(html).not.toContain('callout');
    expect(html).toContain('<p>Just a normal paragraph.</p>');
  });

  it('bare form with same-line title sets the title', () => {
    const html = md().render('[!tip] Pro tip\n');
    expect(html).toContain('callout-tip');
    expect(html).toContain('Pro tip');
  });
});

describe('callout-plugin: nesting', () => {
  it('detects callouts at every blockquote level independently', () => {
    const src = [
      '> [!note] Outer',
      '> Outer body.',
      '>',
      '> > [!warning] Inner',
      '> > Inner body.',
      '',
    ].join('\n');
    const html = md().render(src);
    expect(html).toContain('callout-note');
    expect(html).toContain('callout-warning');
    expect(html.indexOf('callout-note')).toBeLessThan(html.indexOf('callout-warning'));
    // Both wrapper close tags should appear, and the inner one should
    // come before the outer one.
    const innerCloseIdx = html.lastIndexOf('callout-warning');
    expect(innerCloseIdx).toBeGreaterThan(0);
  });
});

describe('callout-plugin: flashcard rendering (#850 polish)', () => {
  it('renders a card as a callout with the divider intact (not a setext heading)', () => {
    const html = md().render('> [!card] ^b54f7825\n> Q\n> ---\n> A\n');
    expect(html).toContain('callout-card');
    // The `---` divider must survive as an <hr>, not eat the front as an <h2>.
    expect(html).toContain('<hr>');
    expect(html).not.toContain('<h2');
    expect(html).toContain('Q');
    expect(html).toContain('A');
  });

  it('drops the trailing ^id block-id from a card header', () => {
    const html = md().render('> [!card] ^b54f7825\n> Q\n> ---\n> A\n');
    // The id is machinery — header falls back to the default "Card".
    expect(html).toContain('class="callout-title-text">Card<');
    expect(html).not.toContain('b54f7825');
  });

  it('keeps the deck name, dropping only the ^id', () => {
    const html = md().render('> [!card] Spanish::Verbs ^abc123\n> Q\n> ---\n> A\n');
    expect(html).toContain('class="callout-title-text">Spanish::Verbs<');
    expect(html).not.toContain('abc123');
  });

  it('leaves a non-card callout title untouched', () => {
    const html = md().render('> [!note] See ^anchor\n> Body.\n');
    expect(html).toContain('See ^anchor');
  });
});
