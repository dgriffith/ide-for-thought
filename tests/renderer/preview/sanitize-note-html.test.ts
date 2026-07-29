/**
 * @vitest-environment jsdom
 *
 * jsdom (not happy-dom): DOMPurify v3's element-table detection skips a few
 * tags under happy-dom's lighter DOM (iframe/embed/form survive FORBID_TAGS),
 * matching the note in `compute-output-sanitize.test.ts`. The Electron
 * renderer runs real Chromium, which jsdom approximates closely enough.
 *
 * Tests for `sanitizeNoteHtml` — the DOMPurify pass the note preview runs
 * before injecting markdown output via `{@html}` (#1327 / M2 + #1332 / L4).
 *
 * Two guarantees, both load-bearing:
 *  1. NEUTRALISE — scripting vectors (`<script>`, `on*` handlers, `<iframe>`/
 *     `<form>`, `javascript:` hrefs) and remote privacy beacons (raw `<img>`
 *     remote `src`, CSS `background:url(https://…)`) are stripped.
 *  2. PRESERVE — the app's rich pipeline output is untouched: KaTeX math
 *     (MathML + inline-`style` spans), mermaid/vega/query placeholders,
 *     wiki/cite links (`data-*`), task-list checkboxes, tables, and the app's
 *     OWN marked remote images (markdown `![](url)`, youtube thumbs).
 *
 * The end-to-end block renders real `createPreviewMarkdown` output through the
 * sanitiser — the actual safety net that the allowlist doesn't silently break
 * a preview feature.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeNoteHtml } from '../../../src/renderer/lib/preview/sanitize-note-html';
import { createPreviewMarkdown, type PreviewMarkdownDeps } from '../../../src/renderer/lib/preview/markdown-config';

function makeDeps(over: Partial<PreviewMarkdownDeps> = {}): PreviewMarkdownDeps {
  return {
    collapsedFences: new Set<number>(),
    runningFences: new Set<number>(),
    getRenderPathOverride: () => null,
    getNotePath: () => null,
    getCanRun: () => false,
    ...over,
  };
}

describe('sanitizeNoteHtml — neutralises scripting vectors', () => {
  it('strips <script> entirely', () => {
    expect(sanitizeNoteHtml('<p>hi</p><script>alert(1)</script>')).not.toContain('<script');
  });

  it('strips inline event handlers but keeps the element', () => {
    const out = sanitizeNoteHtml('<img src="local.png" onerror="alert(1)" alt="x">');
    expect(out).not.toContain('onerror');
    expect(out).toContain('local.png'); // non-remote src preserved
  });

  it('drops <iframe>, <object>, <embed>, <form>', () => {
    const out = sanitizeNoteHtml(
      '<iframe src="https://evil"></iframe><object></object><embed><form><input></form>',
    );
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<object');
    expect(out).not.toContain('<embed');
    expect(out).not.toContain('<form');
  });

  it('neutralises javascript: hrefs', () => {
    const out = sanitizeNoteHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });
});

describe('sanitizeNoteHtml — neutralises L4 remote privacy beacons', () => {
  it('strips remote src from an unmarked raw <img> beacon', () => {
    const out = sanitizeNoteHtml('<img src="https://attacker.example/beacon.gif">');
    expect(out).not.toContain('attacker.example');
    expect(out).not.toMatch(/src="https?:/);
  });

  it('strips protocol-relative src from a raw <img>', () => {
    const out = sanitizeNoteHtml('<img src="//attacker.example/beacon.gif">');
    expect(out).not.toContain('attacker.example');
  });

  it('strips srcset from a raw <img>', () => {
    const out = sanitizeNoteHtml('<img src="x" srcset="https://attacker.example/b.gif 1x">');
    expect(out).not.toContain('srcset');
    expect(out).not.toContain('attacker.example');
  });

  it('strips a remote CSS background url() from inline style', () => {
    const out = sanitizeNoteHtml('<div style="background:url(https://attacker.example/b.png)">x</div>');
    expect(out).not.toContain('attacker.example');
  });

  it('leaves a local data: background url() intact', () => {
    const out = sanitizeNoteHtml('<div style="background:url(data:image/gif;base64,AAA)">x</div>');
    expect(out).toContain('data:image/gif');
  });
});

describe('sanitizeNoteHtml — preserves the app image feature (marked images)', () => {
  it('keeps a marked remote-image src (markdown ![](https://…))', () => {
    const out = sanitizeNoteHtml(
      '<img class="remote-image" data-remote-src="https://ex.com/a.png" src="https://ex.com/a.png" alt="a" loading="lazy">',
    );
    expect(out).toContain('src="https://ex.com/a.png"');
    expect(out).toContain('data-remote-src');
  });

  it('keeps a youtube-thumb remote src', () => {
    const out = sanitizeNoteHtml(
      '<img class="youtube-thumb" data-youtube-id="abc" src="https://img.youtube.com/vi/abc/0.jpg" alt="v">',
    );
    expect(out).toContain('img.youtube.com');
  });

  it('keeps a local-image placeholder (data-rel, no src)', () => {
    const out = sanitizeNoteHtml('<img class="local-image" data-rel="notes/a.png" alt="a">');
    expect(out).toContain('data-rel="notes/a.png"');
    expect(out).toContain('local-image');
  });
});

describe('sanitizeNoteHtml — preserves rich markup', () => {
  it('keeps KaTeX MathML + inline-style spans', () => {
    const katex =
      '<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML">' +
      '<semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow>' +
      '<annotation encoding="application/x-tex">x^2</annotation></semantics></math></span>' +
      '<span class="katex-html" aria-hidden="true" style="height:0.8141em;vertical-align:0em;">x2</span></span>';
    const out = sanitizeNoteHtml(katex);
    expect(out).toContain('<math');
    expect(out).toContain('<msup');
    expect(out).toContain('<annotation');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toMatch(/style="height:0\.8141em/); // positioning style survives
    expect(out).toContain('katex-mathml');
  });

  it('keeps wiki-link data-* attributes', () => {
    const out = sanitizeNoteHtml('<a class="wiki-link" data-target="foo" data-tooltip-kind="note">foo</a>');
    expect(out).toContain('data-target="foo"');
    expect(out).toContain('class="wiki-link"');
  });

  it('keeps a task-list checkbox input', () => {
    const out = sanitizeNoteHtml('<input type="checkbox" data-task-line="3" checked>');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('data-task-line="3"');
    expect(out).toContain('checked');
  });

  it('keeps mermaid / vega / query placeholders', () => {
    expect(sanitizeNoteHtml('<div class="mermaid-block" data-mermaid-pending="1">graph TD</div>'))
      .toContain('data-mermaid-pending="1"');
    expect(sanitizeNoteHtml('<div class="vega-block" data-vega-pending="1" data-vega-mode="lite">{}</div>'))
      .toContain('data-vega-mode="lite"');
    expect(sanitizeNoteHtml('<div class="query-block" data-type="list" data-query="SELECT ?s WHERE {}">x</div>'))
      .toContain('data-query="SELECT ?s WHERE {}"');
  });

  it('keeps tables and footnote anchors', () => {
    const out = sanitizeNoteHtml(
      '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>' +
      '<sup class="footnote-ref"><a href="#fn1" id="fnref1">1</a></sup>',
    );
    expect(out).toContain('<table');
    expect(out).toContain('<th>a</th>');
    expect(out).toContain('href="#fn1"');
  });

  it('returns falsy input unchanged', () => {
    expect(sanitizeNoteHtml('')).toBe('');
  });
});

describe('sanitizeNoteHtml — end-to-end over real preview output', () => {
  const md = createPreviewMarkdown(makeDeps());

  it('leaves a kitchen-sink note intact through render + sanitise', () => {
    const src = [
      '# Heading',
      '',
      'Inline math $x^2$ and a [[foo]] wiki-link.',
      '',
      '![diagram](https://ex.com/a.png)',
      '',
      '- [x] done',
      '- [ ] todo',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '> [!note] A callout',
      '> body',
      '',
      'A footnote.[^1]',
      '',
      '[^1]: the note',
    ].join('\n');
    const out = sanitizeNoteHtml(md.render(src, {}));

    expect(out).toContain('<h1 id="heading">');
    expect(out).toContain('katex'); // math rendered + survived
    expect(out).toContain('wiki-link');
    expect(out).toContain('src="https://ex.com/a.png"'); // marked remote image survives
    expect(out).toContain('remote-image');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('<table');
    expect(out).toContain('footnote'); // footnote machinery survives
    expect(out).not.toContain('<script');
  });

  it('scrubs an embedded raw <script> + beacon while keeping the prose', () => {
    const src = 'Hello **world**.\n\n<script>fetch("https://evil")</script>\n\n<img src="https://tracker.example/b.gif">';
    const out = sanitizeNoteHtml(md.render(src, {}));
    expect(out).toContain('<strong>world</strong>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('evil');
    expect(out).not.toContain('tracker.example');
  });
});
