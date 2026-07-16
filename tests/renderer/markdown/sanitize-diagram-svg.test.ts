/**
 * @vitest-environment jsdom
 *
 * Defense-in-depth sanitisation for mermaid-generated diagram SVG (#1331, L3).
 *
 * jsdom rather than happy-dom for the same reason as the compute-output test:
 * DOMPurify v3's element-table detection matches Chromium closely under jsdom,
 * so the real sanitiser code path is exercised. Verifies the L3 call-out — a
 * `<script>` / inline handler smuggled into diagram SVG is stripped — while the
 * SVG shape and the ids/classes mermaid's post-render bindFunctions relies on
 * survive.
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

  it('preserves the SVG structure, text labels, ids and classes bindFunctions re-queries', () => {
    // Mirrors strict-mode mermaid output: SVG <text> labels (not foreignObject),
    // <style>, ids/classes, inline styles.
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
    expect(out).toContain('Hello Label'); // node label text survives
    expect(out).toContain('style="fill:blue"');
  });

  it('drops a javascript: href on a clickable node link', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="javascript:alert(1)"><rect/></a></svg>';
    const out = sanitizeDiagramSvg(svg);
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<rect');
  });
});
