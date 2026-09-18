/**
 * @vitest-environment happy-dom
 *
 * Security-relevant DOM shape for the #1535 HTML-file preview: the iframe
 * must be sandboxed with an EMPTY token list (no scripting, no same-origin,
 * no forms/popups/navigation), and must carry the embedder-imposed CSP via
 * the `csp` attribute — set imperatively (see HtmlPreview.svelte) because it
 * isn't a typed Svelte iframe prop, so this test is the thing that actually
 * proves it lands on the element.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import HtmlPreview from '../../../src/renderer/lib/components/HtmlPreview.svelte';
import { HTML_PREVIEW_CSP, buildHtmlPreviewSrcdoc } from '../../../src/renderer/lib/preview/html-preview-csp';

afterEach(cleanup);

function renderPreview(content: string) {
  const { container } = render(HtmlPreview, { content });
  const iframe = container.querySelector('iframe');
  if (!iframe) throw new Error('expected an iframe');
  return iframe;
}

describe('HtmlPreview (#1535)', () => {
  it('sandboxes with an empty token list — no scripting, no same-origin, static markup only', () => {
    const iframe = renderPreview('<p>hi</p>');
    expect(iframe.hasAttribute('sandbox')).toBe(true);
    const tokens = (iframe.getAttribute('sandbox') ?? '').split(/\s+/).filter(Boolean);
    expect(tokens).toEqual([]);
  });

  it('imposes the embedded-enforcement csp attribute with the exact shared policy', () => {
    const iframe = renderPreview('<p>hi</p>');
    expect(iframe.getAttribute('csp')).toBe(HTML_PREVIEW_CSP);
  });

  it('sends no referrer', () => {
    const iframe = renderPreview('<p>hi</p>');
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('sets srcdoc to the meta-CSP-prefixed content, matching buildHtmlPreviewSrcdoc', () => {
    const iframe = renderPreview('<h1>Artifact</h1>');
    expect(iframe.srcdoc).toBe(buildHtmlPreviewSrcdoc('<h1>Artifact</h1>'));
  });

  it('never has a src attribute (no network navigation — srcdoc only)', () => {
    const iframe = renderPreview('<p>hi</p>');
    expect(iframe.hasAttribute('src')).toBe(false);
  });

  it('re-renders srcdoc when content changes, keeping csp set', async () => {
    const { container, rerender } = render(HtmlPreview, { content: '<p>one</p>' });
    await rerender({ content: '<p>two</p>' });
    const iframe = container.querySelector('iframe')!;
    expect(iframe.srcdoc).toBe(buildHtmlPreviewSrcdoc('<p>two</p>'));
    expect(iframe.getAttribute('csp')).toBe(HTML_PREVIEW_CSP);
  });
});
