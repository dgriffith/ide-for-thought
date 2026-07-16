/**
 * @vitest-environment jsdom
 *
 * Defense-in-depth sanitisation for mermaid-generated diagram SVG (#1331, L3).
 *
 * Verifies the L3 call-out — a `<script>` / inline handler / `javascript:` URL
 * smuggled into diagram SVG is stripped — while the diagram content mermaid
 * actually emits survives, crucially the HTML node labels mermaid v11 renders
 * inside `<foreignObject>` (a DOMPurify allowlist pass would delete those; the
 * regression this guards against).
 */

import { describe, it, expect } from 'vitest';
import { sanitizeDiagramSvg } from '../../../src/renderer/lib/markdown/sanitize-diagram-svg';

describe('sanitizeDiagramSvg (#1331)', () => {
  it('strips a <script> smuggled into the SVG', () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><g class="node"><rect/></g></svg>';
    const out = sanitizeDiagramSvg(evil);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('<rect');
  });

  it('strips inline event-handler attributes on diagram nodes', () => {
    const out = sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)" onload="steal()"/></svg>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('alert');
    expect(out).toContain('<rect');
  });

  it('drops a javascript: href on a clickable node link', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="javascript:alert(1)"><rect/></a></svg>';
    const out = sanitizeDiagramSvg(svg);
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<rect');
  });

  it('removes SMIL animation elements (animate-to-script vector)', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect>'
      + '<set attributeName="href" to="javascript:alert(1)"/>'
      + '<animate attributeName="x" values="javascript:alert(2)"/></rect></svg>';
    const out = sanitizeDiagramSvg(svg);
    expect(out).not.toContain('<set');
    expect(out).not.toContain('<animate');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<rect');
  });

  it('preserves SVG <text> labels, <style>, ids, classes and inline styles', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" id="mermaid-1">'
      + '<style>.node{fill:red}</style>'
      + '<g class="node clickable" id="node-a"><rect x="0" y="0" width="10" height="10" style="fill:blue"/>'
      + '<text class="nodeLabel">Hello Label</text></g><path class="edge" d="M0 0 L10 10"/></svg>';
    const out = sanitizeDiagramSvg(svg);
    expect(out).toContain('id="mermaid-1"');
    expect(out).toContain('id="node-a"');
    expect(out).toContain('class="node clickable"');
    expect(out).toContain('<style');
    expect(out).toContain('<path');
    expect(out).toContain('Hello Label');
    expect(out).toContain('style="fill:blue"');
  });

  it('preserves mermaid v11 foreignObject HTML labels (the regression #1331 guards)', () => {
    // Mermaid v11 renders node labels as HTML inside <foreignObject>. This must
    // survive sanitisation — a DOMPurify allowlist pass deletes it, blanking
    // every diagram label.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g class="node">'
      + '<foreignObject width="80" height="20">'
      + '<div xmlns="http://www.w3.org/1999/xhtml" class="nodeLabel"><span class="nodeLabel">Order Service</span></div>'
      + '</foreignObject></g></svg>';
    const out = sanitizeDiagramSvg(svg);
    expect(out.toLowerCase()).toContain('foreignobject');
    expect(out).toContain('Order Service');
    expect(out).toContain('class="nodeLabel"');
  });

  it('strips a <script> hidden inside a foreignObject label', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>'
      + '<div xmlns="http://www.w3.org/1999/xhtml">safe<script>alert(1)</script></div>'
      + '</foreignObject></svg>';
    const out = sanitizeDiagramSvg(svg);
    expect(out).toContain('safe');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
  });
});
