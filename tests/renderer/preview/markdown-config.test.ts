/**
 * @vitest-environment happy-dom
 *
 * Unit tests for `createPreviewMarkdown(deps)` — the fully-configured
 * MarkdownIt instance behind the note preview (#1087). Every custom renderer
 * rule (heading/paragraph/list-item anchors, the relative-image rule, the fence
 * dispatcher + its sub-renderers, the `:::query-…` block directive) plus the
 * plugin battery (math, callouts, DOI, highlight, footnotes, wiki-links, note
 * tags, transclusions) is exercised here at the pure string-in → HTML-out
 * level. The compute-output branch reaches for `btoa` / DOMPurify, so the file
 * runs under happy-dom.
 */
import { describe, it, expect } from 'vitest';
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

/** Render `src` through a fresh instance built from `deps`. */
function render(src: string, over: Partial<PreviewMarkdownDeps> = {}, env: object = {}): string {
  const md = createPreviewMarkdown(makeDeps(over));
  return md.render(src, env);
}

describe('createPreviewMarkdown — construction', () => {
  it('returns a MarkdownIt-shaped instance with a render method', () => {
    const md = createPreviewMarkdown(makeDeps());
    expect(typeof md.render).toBe('function');
    expect(md.render('hello')).toContain('<p>hello</p>');
  });

  it('has setext (underline) headings disabled — `---` is a thematic break', () => {
    const html = render('Title\n---\n');
    expect(html).not.toContain('<h2');
    expect(html).toContain('<hr');
  });
});

describe('heading anchors', () => {
  it('slugifies heading text into an id for [[note#heading]] navigation', () => {
    const html = render('# Hello World');
    expect(html).toContain('<h1 id="hello-world">');
    expect(html).toContain('Hello World');
  });

  it('handles deeper heading levels too', () => {
    expect(render('### Sub Section')).toContain('<h3 id="sub-section">');
  });

  it('omits the id when the text slugifies to empty', () => {
    const html = render('# !!!');
    expect(html).toContain('<h1>');
    expect(html).not.toContain('id=');
  });
});

describe('block-id paragraphs (^id)', () => {
  it('mirrors a trailing ^block-id onto the <p> and strips the marker', () => {
    const html = render('Some text ^my-block');
    expect(html).toContain('id="^my-block"');
    expect(html).toContain('Some text');
    expect(html).not.toContain('^my-block<');
    expect(html).not.toContain('>Some text ^my-block');
  });

  it('leaves an ordinary paragraph untouched', () => {
    const html = render('Just a sentence.');
    expect(html).toContain('<p>Just a sentence.</p>');
    expect(html).not.toContain('id=');
  });
});

describe('task-list items', () => {
  it('renders an unchecked checkbox with the source line', () => {
    const html = render('- [ ] todo item');
    expect(html).toContain('class="task-list-item"');
    expect(html).toContain('data-task-line="0"');
    expect(html).toContain('<input type="checkbox" data-task-line="0"> ');
    expect(html).not.toContain('[ ]');
    expect(html).toContain('todo item');
  });

  it('renders a checked checkbox for [x] (and [X])', () => {
    expect(render('- [x] done')).toContain('checked>');
    expect(render('- [X] done')).toContain('checked>');
  });

  it('adds the env lineOffset so the checkbox points at the note line', () => {
    const html = render('- [ ] offset task', {}, { lineOffset: 7 });
    expect(html).toContain('data-task-line="7"');
  });

  it('leaves a plain bullet list item without a checkbox', () => {
    const html = render('- plain item');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('task-list-item');
  });
});

describe('wiki links', () => {
  it('renders a plain [[target]] as a bare wiki-link', () => {
    const html = render('See [[Some Note]].');
    expect(html).toContain('<a class="wiki-link" data-target="Some Note">Some Note</a>');
  });

  it('honors a |display override', () => {
    const html = render('[[Some Note|the label]]');
    expect(html).toContain('data-target="Some Note"');
    expect(html).toContain('>the label<');
  });

  it('renders a typed link with a colored badge', () => {
    const html = render('[[supports::Claim A]]');
    expect(html).toContain('typed-link');
    expect(html).toContain('link-type-badge');
    expect(html).toContain('Supports');
    expect(html).toContain('data-target="Claim A"');
  });

  it('renders a cite:: link with cite-link + source data attrs', () => {
    const html = render('[[cite::source-42]]');
    expect(html).toContain('cite-link');
    expect(html).toContain('data-source-id="source-42"');
    expect(html).toContain('data-display-override="0"');
  });

  it('marks display-override=1 on a cite link with a custom label', () => {
    const html = render('[[cite::source-42|Smith 2020]]');
    expect(html).toContain('data-display-override="1"');
    expect(html).toContain('Smith 2020');
  });

  it('renders a quote:: link with quote-link + excerpt data attrs', () => {
    const html = render('[[quote::excerpt-7]]');
    expect(html).toContain('quote-link');
    expect(html).toContain('data-excerpt-id="excerpt-7"');
  });
});

describe('note tags', () => {
  it('renders #tag as a note-tag span', () => {
    const html = render('A note about #topic here');
    expect(html).toContain('<span class="note-tag" data-tag="topic">#topic</span>');
  });
});

describe('transclusions', () => {
  it('renders a standalone ![[target]] line as a transclusion placeholder', () => {
    const html = render('![[Embedded Note]]');
    expect(html).toContain('class="transclusion"');
    expect(html).toContain('data-embed="Embedded Note"');
  });
});

describe('image rule', () => {
  it('emits a local-image placeholder for a relative path resolved against the note', () => {
    const html = render('![alt](pics/diagram.png)', { getNotePath: () => 'notes/main.md' });
    expect(html).toContain('class="local-image"');
    expect(html).toContain('data-rel="notes/pics/diagram.png"');
    expect(html).toContain('alt=');
  });

  it('resolves against the transclusion path override when set', () => {
    const html = render('![](pic.png)', {
      getRenderPathOverride: () => 'sub/embed.md',
      getNotePath: () => 'notes/main.md',
    });
    expect(html).toContain('data-rel="sub/pic.png"');
  });

  it('passes a data: URL through unchanged', () => {
    const html = render('![x](data:image/png;base64,AAAA)');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toContain('local-image');
  });

  it('emits a remote-image placeholder for an http(s) source', () => {
    const html = render('![pic](https://example.com/x.png "cap")');
    expect(html).toContain('class="remote-image"');
    expect(html).toContain('data-remote-src="https://example.com/x.png"');
    expect(html).toContain('title="cap"');
    expect(html).toContain('loading="lazy"');
  });

  it('upgrades a protocol-relative // source to https for the remote copy', () => {
    const html = render('![](//cdn.test/a.png)');
    expect(html).toContain('data-remote-src="https://cdn.test/a.png"');
    expect(html).toContain('src="//cdn.test/a.png"');
  });

  it('emits a <video> player for a local video path', () => {
    const html = render('![](clip.mp4)', { getNotePath: () => 'notes/n.md' });
    expect(html).toContain('<video class="local-media"');
    expect(html).toContain('data-rel="notes/clip.mp4"');
    expect(html).toContain('controls');
  });

  it('emits an <audio> player for a local audio path', () => {
    const html = render('![](song.mp3)');
    expect(html).toContain('<audio class="local-media"');
    expect(html).toContain('data-rel="song.mp3"');
  });
});

describe('fence dispatcher — mermaid', () => {
  it('wraps a mermaid fence with a collapse toolbar and pending block', () => {
    const html = render('```mermaid\ngraph TD\nA-->B\n```');
    expect(html).toContain('fence-mermaid');
    expect(html).toContain('data-fence-line="1"');
    expect(html).toContain('mermaid-block');
    expect(html).toContain('data-mermaid-pending="1"');
    expect(html).toContain('▾'); // expanded chevron
  });

  it('reflects collapsed state from the shared set', () => {
    const html = render('```mermaid\ngraph TD\nA-->B\n```', { collapsedFences: new Set([1]) });
    expect(html).toContain('fence-collapsed');
    expect(html).toContain('▸'); // collapsed chevron
  });

  it('escapes HTML-special characters in the diagram body', () => {
    const html = render('```mermaid\nA-->|"x<y"|B\n```');
    expect(html).toContain('&lt;');
    expect(html).not.toContain('x<y');
  });
});

describe('fence dispatcher — vega / vega-lite', () => {
  it('renders a full-vega fence with mode=full and a collapse toolbar', () => {
    const html = render('```vega\n{"marks":[]}\n```');
    expect(html).toContain('fence-vega');
    expect(html).toContain('data-vega-mode="full"');
    expect(html).toContain('vega-block');
    expect(html).not.toContain('refresh-vega'); // inline (unbound) chart
  });

  it('renders a vega-lite fence with mode=lite', () => {
    const html = render('```vega-lite\n{"mark":"bar"}\n```');
    expect(html).toContain('data-vega-mode="lite"');
  });

  it('adds a refresh button for a data-bound (sparql) chart', () => {
    const html = render('```vega-lite\n{"data":{"sparql":"SELECT * WHERE {}"}}\n```');
    expect(html).toContain('data-fence-action="refresh-vega"');
  });

  it('tolerates a malformed JSON body (no refresh button, still renders)', () => {
    const html = render('```vega-lite\nnot json\n```');
    expect(html).toContain('vega-block');
    expect(html).not.toContain('refresh-vega');
  });
});

describe('fence dispatcher — youtube', () => {
  it('renders a poster card for a valid YouTube URL', () => {
    const html = render('```youtube\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n```');
    expect(html).toContain('class="youtube-embed"');
    expect(html).toContain('youtube-thumb');
  });

  it('renders an inline error card for an unrecognized URL', () => {
    const html = render('```youtube\nhttps://example.com/not-a-video\n```');
    expect(html).toContain('youtube-embed-error');
  });
});

describe('fence dispatcher — runnable fences', () => {
  it('renders a runnable python fence without a ▶ button when canRun is false', () => {
    const html = render('```python\nprint(1)\n```');
    expect(html).toContain('fence-runnable');
    expect(html).toContain('data-fence-lang="python"');
    expect(html).not.toContain('fence-run-btn');
  });

  it('shows the ▶ run button when the host can run', () => {
    const html = render('```sparql\nSELECT * WHERE {}\n```', { getCanRun: () => true });
    expect(html).toContain('fence-run-btn');
    expect(html).toContain('▶');
  });

  it('disables the run button and shows ⋯ while the fence is running', () => {
    const html = render('```sql\nSELECT 1\n```', {
      getCanRun: () => true,
      runningFences: new Set([1]),
    });
    expect(html).toContain('fence-run-btn');
    expect(html).toContain('disabled');
    expect(html).toContain('⋯');
  });

  it('reflects collapsed state on a runnable fence', () => {
    const html = render('```python\nprint(1)\n```', { collapsedFences: new Set([1]) });
    expect(html).toContain('fence-collapsed');
  });
});

describe('fence dispatcher — default code blocks', () => {
  it('wraps a labeled non-runnable fence in a code-block container', () => {
    const html = render('```js\nconst x = 1;\n```');
    expect(html).toContain('class="code-block" data-language="js"');
  });

  it('leaves a bare (unlabeled) fence without the code-block wrapper', () => {
    const html = render('```\nplain code\n```');
    expect(html).not.toContain('code-block');
    expect(html).toContain('<pre>');
  });
});

describe('fence dispatcher — compute output', () => {
  it('renders an adjacent output fence as a text artifact, wrapped with the menu', () => {
    const src = '```python\nprint("hi")\n```\n```output\n{"type":"text","value":"hi"}\n```';
    const html = render(src);
    expect(html).toContain('compute-output-text');
    expect(html).toContain('hi');
    expect(html).toContain('compute-output-wrap'); // saveable + source found
  });

  it('renders a table output with headers and rows', () => {
    const src = '```sql\nSELECT 1\n```\n```output\n{"type":"table","columns":["a"],"rows":[[1],[2]]}\n```';
    const html = render(src);
    expect(html).toContain('compute-output-table');
    expect(html).toContain('<th>a</th>');
  });

  it('renders an error output without the save menu', () => {
    const src = '```python\nboom\n```\n```output\n{"type":"error","message":"NameError"}\n```';
    const html = render(src);
    expect(html).toContain('compute-output-error');
    expect(html).toContain('NameError');
    expect(html).not.toContain('compute-output-wrap');
  });

  it('renders a malformed output payload as raw text', () => {
    const html = render('```output\nnot-json\n```');
    expect(html).toContain('compute-output-raw');
  });

  it('renders a standalone (source-less) output fence without the menu wrap', () => {
    const html = render('```output\n{"type":"text","value":"orphan"}\n```');
    expect(html).toContain('compute-output-text');
    expect(html).toContain('orphan');
    expect(html).not.toContain('compute-output-wrap');
  });
});

describe('query directive :::query-…', () => {
  it('renders a query block with type + query and no config', () => {
    const html = render(':::query-list\nSELECT * WHERE {}\n:::');
    expect(html).toContain('class="query-block"');
    expect(html).toContain('data-type="list"');
    expect(html).toContain('data-query="SELECT * WHERE {}"');
    expect(html).not.toContain('data-config');
    expect(html).toContain('query-loading');
  });

  it('parses a config block above the --- separator', () => {
    const html = render(':::query-table\nlimit: 5\nsort: name\n---\nSELECT * WHERE {}\n:::');
    expect(html).toContain('data-type="table"');
    expect(html).toContain('data-config=');
    // config JSON is attr-escaped
    expect(html).toContain('limit');
    expect(html).toContain('&quot;5&quot;');
  });

  it('ignores an unclosed directive (falls through to normal markdown)', () => {
    const html = render(':::query-list\nSELECT * WHERE {}');
    expect(html).not.toContain('query-block');
    expect(html).toContain(':::query-list');
  });

  it('does not treat a non-query ::: line as a directive', () => {
    const html = render(':::note\nbody\n:::');
    expect(html).not.toContain('query-block');
  });
});

describe('plugin battery', () => {
  it('renders inline math via KaTeX', () => {
    const html = render('An equation $x^2$ here.');
    expect(html).toContain('katex');
  });

  it('renders block math in a math-block wrapper', () => {
    const html = render('$$\nx^2\n$$');
    expect(html).toContain('math-block');
  });

  it('renders ==highlight== as a <mark>', () => {
    const html = render('This is ==important== text.');
    expect(html).toContain('<mark');
    expect(html).toContain('important');
  });

  it('renders a colored highlight with its palette class', () => {
    const html = render('==yellow:caution==');
    expect(html).toContain('hl-yellow');
  });

  it('auto-links a bare DOI', () => {
    const html = render('See 10.1145/3677999.3678002 for the data.');
    expect(html).toContain('href="https://doi.org/10.1145/3677999.3678002"');
  });

  it('renders a callout box from a blockquote marker', () => {
    const html = render('> [!warning] Careful\n> body text');
    expect(html).toContain('callout');
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain('Careful');
  });

  it('renders footnotes with a back-of-note section', () => {
    const html = render('Text with a note.[^1]\n\n[^1]: The footnote body.');
    expect(html).toContain('footnote');
    expect(html).toContain('The footnote body.');
  });

  it('linkifies a bare URL (linkify:true)', () => {
    const html = render('Visit https://example.com today.');
    expect(html).toContain('<a href="https://example.com"');
  });

  it('allows raw HTML (html:true)', () => {
    const html = render('<div class="raw">hi</div>');
    expect(html).toContain('<div class="raw">hi</div>');
  });
});

describe('tables & standard markdown', () => {
  it('renders a GFM table', () => {
    const html = render('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>1</td>');
  });
});
