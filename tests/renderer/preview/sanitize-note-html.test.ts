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
import { appImageMark, APP_IMAGE_TOKEN } from '../../../src/renderer/lib/preview/app-image-mark';
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

/** The `src` attribute of the first <img> in `html` (parsed, not substring-matched:
 *  `data-remote-src="…"` contains `src="…"` too, which once hid a stripped src). */
function imgSrc(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('img')?.getAttribute('src') ?? null;
}

describe('sanitizeNoteHtml — preserves the app image feature (token-marked images, #2561)', () => {
  it('keeps the remote src of an app-generated remote-image (markdown ![](https://…))', () => {
    const out = sanitizeNoteHtml(
      `<img class="remote-image"${appImageMark()} data-remote-src="https://ex.com/a.png" src="https://ex.com/a.png" alt="a" loading="lazy">`,
    );
    expect(imgSrc(out)).toBe('https://ex.com/a.png');
  });

  it('keeps an app-generated youtube-thumb remote src', () => {
    const out = sanitizeNoteHtml(
      `<img class="youtube-thumb"${appImageMark()} data-youtube-id="abc" src="https://img.youtube.com/vi/abc/0.jpg" alt="v">`,
    );
    expect(imgSrc(out)).toBe('https://img.youtube.com/vi/abc/0.jpg');
  });

  it('keeps a local-image placeholder (data-rel, no src)', () => {
    const out = sanitizeNoteHtml(`<img class="local-image"${appImageMark()} data-rel="notes/a.png" alt="a">`);
    expect(out).toContain('data-rel="notes/a.png"');
    expect(out).toContain('local-image');
  });

  it('end to end: the real markdown image rule and youtube fence keep their images', () => {
    const md = createPreviewMarkdown(makeDeps());
    expect(imgSrc(sanitizeNoteHtml(md.render('![a](https://ex.com/a.png)')))).toBe('https://ex.com/a.png');
  });
});

describe('sanitizeNoteHtml — a note can\'t spoof the app-image marker (#2561)', () => {
  it.each([
    ['remote-image class + data-remote-src', '<img class="remote-image" data-remote-src="https://t.example/b.gif" src="https://t.example/b.gif">'],
    ['youtube-thumb class', '<img class="youtube-thumb" src="https://t.example/b.gif">'],
    ['local-image class + data-rel', '<img class="local-image" data-rel="x.png" src="https://t.example/b.gif">'],
    ['a guessed token', '<img data-minerva-img="00000000000000000000000000000000" src="https://t.example/b.gif">'],
  ])('neutralises a raw <img> wearing %s', (_label, html) => {
    expect(imgSrc(sanitizeNoteHtml(html))).toBeNull();
  });

  it('the token is random per load, not a constant a note could copy from the source', () => {
    expect(APP_IMAGE_TOKEN).toMatch(/^[0-9a-f]{32}$/);
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

describe('sanitizeNoteHtml — page-level tags a note could redress the app with (#2557)', () => {
  it('drops <style>, <link>, <meta> and <base>, keeping the surrounding content', () => {
    const out = sanitizeNoteHtml(
      '<p>keep</p><style>.approve-btn{display:none}</style>'
      + '<link rel="stylesheet" href="redress.css">'
      + '<meta http-equiv="refresh" content="0; url=https://attacker.example/">'
      + '<base href="https://attacker.example/"><p>also keep</p>',
    );
    for (const tag of ['<style', '<link', '<meta', '<base']) expect(out).not.toContain(tag);
    expect(out).not.toContain('approve-btn');
    expect(out).toContain('<p>keep</p>');
    expect(out).toContain('<p>also keep</p>');
  });

  it('drops a <style> nested inside inline SVG', () => {
    const out = sanitizeNoteHtml('<svg width="10" height="10"><style>.status-bar{visibility:hidden}</style><rect width="10" height="10"></rect></svg>');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('status-bar');
    expect(out).toContain('<rect');
  });

  it('strips every tag from the hostile-thoughtbase redress note, end to end through the real markdown pipeline', async () => {
    const { STYLE_REDRESS_NOTE, STYLE_REDRESS_MARKER } = await import('../../helpers/hostile-thoughtbase');
    const md = createPreviewMarkdown(makeDeps());
    const out = sanitizeNoteHtml(md.render(STYLE_REDRESS_NOTE));
    for (const tag of ['<style', '<link', '<meta', '<base']) expect(out, tag).not.toContain(tag);
    expect(out).not.toContain('t.example/beacon');
    expect(out).toContain(STYLE_REDRESS_MARKER);
  });
});

describe('sanitizeNoteHtml — image size (#2666)', () => {
  it('keeps width and height on an <img>, and still drops <style>', () => {
    const out = sanitizeNoteHtml('<p><img src="data:image/png;base64,AAA" alt="x" width="400" height="300"></p><style>img{width:9999px}</style>');
    expect(out).toContain('width="400"');
    expect(out).toContain('height="300"');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('9999px');
  });

  it('keeps the size and the resize frame from the real markdown pipeline', () => {
    const md = createPreviewMarkdown(makeDeps({ getNotePath: () => 'n.md', getCanResize: () => true }));
    const out = sanitizeNoteHtml(md.render('![shot|400x300](pic.png)\n'));
    expect(out).toMatch(/<img [^>]*width="400"[^>]*height="300"/);
    expect(out).toContain('alt="shot"');
    expect(out).toContain('data-resize-kind="image"');
    expect(out).toContain('data-image-ref=');
    expect(out).toMatch(/role="slider"[^>]*tabindex="0"/);
  });

  it('strips a remote url() a raw <img> style carries, keeping its size', () => {
    const out = sanitizeNoteHtml('<img src="data:image/png;base64,AAA" width="200" style="background:url(https://tracker.example/b.png)">');
    expect(out).toContain('width="200"');
    expect(out).not.toContain('tracker.example');
  });
});
