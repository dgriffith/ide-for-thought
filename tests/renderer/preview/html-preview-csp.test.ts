/**
 * Pure-logic tests for the #1535 HTML-preview CSP. `HtmlPreview.svelte` pairs
 * this with an empty-sandbox (no tokens — scripting off, opaque origin)
 * iframe and the `csp` embedded-enforcement attribute — this file only locks
 * down the policy string and the srcdoc it builds. Scripts are `'none'` here
 * deliberately, not merely by omission: a `srcdoc` document's CSP intersects
 * with its parent's, so Minerva's own strict top-level `script-src` would
 * block inline scripts regardless of what this policy allowed — see the
 * comment on `HTML_PREVIEW_CSP` for the full story.
 */
import { describe, it, expect } from 'vitest';
import { HTML_PREVIEW_CSP, buildHtmlPreviewSrcdoc } from '../../../src/renderer/lib/preview/html-preview-csp';

describe('HTML_PREVIEW_CSP (#1535)', () => {
  it('blocks every form of network egress', () => {
    expect(HTML_PREVIEW_CSP).toMatch(/connect-src 'none'/);
    expect(HTML_PREVIEW_CSP).toMatch(/frame-src 'none'/);
    expect(HTML_PREVIEW_CSP).toMatch(/default-src 'none'/);
  });

  it('restricts image/font loads to data:/blob: — no remote tracking pixels', () => {
    const imgSrc = HTML_PREVIEW_CSP.match(/img-src ([^;]+)/)![1];
    expect(imgSrc).toBe('data: blob:');
    expect(imgSrc).not.toMatch(/https?:/);
    const fontSrc = HTML_PREVIEW_CSP.match(/font-src ([^;]+)/)![1];
    expect(fontSrc).toBe('data:');
  });

  it('blocks form submission', () => {
    expect(HTML_PREVIEW_CSP).toMatch(/form-action 'none'/);
  });

  it('blocks scripts entirely, but allows inline styling', () => {
    const scriptSrc = HTML_PREVIEW_CSP.match(/script-src ([^;]+)/)![1];
    expect(scriptSrc).toBe("'none'");
    const styleSrc = HTML_PREVIEW_CSP.match(/style-src ([^;]+)/)![1];
    expect(styleSrc).toBe("'unsafe-inline'");
  });
});

describe('buildHtmlPreviewSrcdoc (#1535)', () => {
  it('prepends a meta-tag CSP carrying the exact same policy, ahead of the content', () => {
    const srcdoc = buildHtmlPreviewSrcdoc('<h1>hi</h1>');
    expect(srcdoc.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(srcdoc).toContain(HTML_PREVIEW_CSP);
    expect(srcdoc.endsWith('<h1>hi</h1>')).toBe(true);
  });

  it('does not sanitize or transform the content — the sandbox/CSP is the boundary, not text filtering', () => {
    const raw = '<script>alert(1)</script><style>body{color:red}</style>';
    expect(buildHtmlPreviewSrcdoc(raw)).toContain(raw);
  });
});
