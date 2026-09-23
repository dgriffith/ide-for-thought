/**
 * @vitest-environment jsdom
 *
 * Incremental DOM patching for the streaming reply (#2219).
 *
 * Two things are being defended, and they pull against each other:
 *
 *  1. **Correctness.** The patched DOM must equal a single full render of the
 *     same text, at every intermediate step — not just at the end. This is the
 *     trap in "render only the stable prefix": markdown has no prefix-stability
 *     property, so a prefix-splitting implementation renders a half-written
 *     construct as literal text and then flips it. The cases below walk a
 *     stream character-by-character across exactly those boundaries (an
 *     unterminated fence, a half-written link, a list going loose, a setext
 *     heading) and assert equality with a full render at EVERY prefix.
 *
 *  2. **The saving.** A count gate, not a timer: appending to the last
 *     paragraph must replace one node, not the whole tree.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import MarkdownIt from 'markdown-it';
import { patchRenderedMarkdown } from '../../src/renderer/lib/conversations/streaming-markdown';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: true });

let host: HTMLDivElement;
let scratch: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  scratch = document.createElement('div');
  document.body.appendChild(host);
});

/** What a single, non-incremental full render of `src` produces. */
function fullRender(src: string): string {
  const d = document.createElement('div');
  d.innerHTML = md.render(src);
  return d.innerHTML;
}

function patch(src: string): number {
  return patchRenderedMarkdown(host, scratch, md.render(src));
}

/**
 * Stream `text` one character at a time, asserting after EVERY prefix that the
 * patched DOM is byte-identical to a full render of that same prefix. This is
 * the assertion that a prefix-splitting implementation cannot pass.
 */
function streamCharByChar(text: string): void {
  for (let i = 1; i <= text.length; i++) {
    const prefix = text.slice(0, i);
    patch(prefix);
    expect(host.innerHTML, `mismatch after ${i} chars: ${JSON.stringify(prefix)}`)
      .toBe(fullRender(prefix));
  }
}

describe('patchRenderedMarkdown — correctness at every intermediate step', () => {
  it('matches a full render across a half-written fenced code block', () => {
    // The canonical trap: while the fence is unterminated markdown-it renders
    // it as a code block anyway, and the content shifts as lines arrive.
    streamCharByChar('Intro text.\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n\nAfter.');
  });

  it('matches a full render across a half-written link', () => {
    // `[text]` is literal until `(` lands, then becomes an anchor mid-typing —
    // an element boundary that moves under the diff.
    streamCharByChar('See [the docs](https://example.com/a/b) for more.');
  });

  it('matches a full render when a list flips from tight to loose', () => {
    // `- a` alone is <li>a</li>; a blank line plus `- b` rewrites the FIRST
    // item to <li><p>a</p></li>. A prefix-split implementation would have
    // already committed the tight form.
    streamCharByChar('- alpha\n- beta\n\n- gamma\n');
  });

  it('matches a full render when a setext heading rewrites the line above it', () => {
    // `Title` is a paragraph until `===` arrives and retroactively makes it h1.
    streamCharByChar('Title\n===\n\nBody text here.\n');
  });

  it('matches a full render across an emphasis run that only closes later', () => {
    streamCharByChar('This is **bold text** and this is *italic*.\n');
  });

  it('matches a full render across a table that only becomes a table on row 2', () => {
    streamCharByChar('| a | b |\n| - | - |\n| 1 | 2 |\n');
  });
});

describe('patchRenderedMarkdown — the saving', () => {
  it('replaces only the trailing nodes when a delta extends the last paragraph', () => {
    patch('# Heading\n\nFirst para.\n\n- one\n- two\n\nTrailing para');
    const before = host.childNodes.length;
    const kept = [host.childNodes[0], host.childNodes[2], host.childNodes[4]];

    const replaced = patch('# Heading\n\nFirst para.\n\n- one\n- two\n\nTrailing para plus more');

    // TWO, not one — and the reason is worth pinning rather than rounding off.
    // markdown-it separates top-level blocks with "\n" text nodes and emits a
    // trailing one after the final block:
    //   <h1>…</h1> "\n" <p>…</p> "\n" <ul>…</ul> "\n" <p>…</p> "\n"
    // so the changed paragraph is followed by a text node that must move with
    // it. The property that matters is what is NOT touched: the heading, the
    // first paragraph and the whole list survive by identity.
    expect(replaced).toBe(2);
    expect(host.childNodes.length).toBe(before);
    expect([host.childNodes[0], host.childNodes[2], host.childNodes[4]]).toEqual(kept);
  });

  it('reuses the stable prefix node objects rather than recreating them', () => {
    patch('# Heading\n\nFirst para.\n\nTail');
    const heading = host.firstChild;
    const firstPara = host.childNodes[2];

    patch('# Heading\n\nFirst para.\n\nTail extended');

    // Identity, not equality: these are the very same DOM nodes. That is what
    // keeps a Selection anchored inside them alive.
    expect(host.firstChild).toBe(heading);
    expect(host.childNodes[2]).toBe(firstPara);
  });

  it('a mid-stream text selection survives a delta', () => {
    patch('# Heading\n\nSelect some of this paragraph.\n\nTail');
    const para = host.childNodes[2] as HTMLElement;
    const textNode = para.firstChild!;

    const range = document.createRange();
    range.setStart(textNode, 7);
    range.setEnd(textNode, 11);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(sel.toString()).toBe('some');

    patch('# Heading\n\nSelect some of this paragraph.\n\nTail grows longer');

    // The node the selection is anchored in was not destroyed, so the
    // selection still resolves to the same text. Under the old
    // `innerHTML = …` path this collapses to ''.
    expect(window.getSelection()!.toString()).toBe('some');
  });

  it('total node churn over a realistic stream is far below a full rebuild', () => {
    const text = [
      '## Section\n\nA paragraph of prose that runs on for a bit.\n\n',
      '- first bullet\n- second bullet\n- third bullet\n\n',
      '```ts\nfunction f(a: number) { return a * 2; }\n```\n\n',
      'A closing paragraph with a [link](https://example.com).\n',
    ].join('');

    let replaced = 0;
    // ~11-char deltas, the measured mean size from a real stream.
    for (let i = 0; i < text.length; i += 11) {
      replaced += patch(text.slice(0, i + 11));
    }

    const finalTopLevel = host.childNodes.length;
    const flushes = Math.ceil(text.length / 11);
    // A full innerHTML rebuild would touch every top-level node every flush.
    expect(replaced).toBeLessThan(flushes * finalTopLevel * 0.25);
    expect(host.innerHTML).toBe(fullRender(text));
  });
});

describe('patchRenderedMarkdown — edge cases', () => {
  it('clears the host when the text goes empty', () => {
    patch('# Something\n\nBody');
    expect(host.childNodes.length).toBeGreaterThan(0);

    patch('');
    expect(host.innerHTML).toBe('');
  });

  it('handles a whole-document rewrite (nothing stable)', () => {
    patch('# Alpha\n\nOne');
    const replaced = patch('> A blockquote instead\n\n1. numbered\n');
    expect(replaced).toBeGreaterThan(0);
    expect(host.innerHTML).toBe(fullRender('> A blockquote instead\n\n1. numbered\n'));
  });

  it('leaves the scratch element empty so it can be reused', () => {
    patch('# Heading\n\nBody text');
    expect(scratch.childNodes.length).toBe(0);
  });
});
