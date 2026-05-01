/**
 * @vitest-environment jsdom
 *
 * Sanitisation acceptance test for rich compute output (#243).
 *
 * jsdom rather than happy-dom because DOMPurify v3's element-table
 * detection skips a few tags under happy-dom's lighter DOM (notably
 * `<iframe>` / `<embed>` / `<form>` survive even with FORBID_TAGS
 * set). The Electron renderer runs against real Chromium so this
 * mismatch is test-harness-only — but jsdom matches Chromium
 * closely enough to drive the real DOMPurify code path.
 *
 * Verifies the issue's call-out: `<script>alert(1)</script>` in HTML
 * output gets stripped. Covers the other dangerous-element cases
 * (`<iframe>`, inline event handlers, etc.) at the same time so the
 * allowlist contract is pinned down.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeComputeOutputHtml } from '../../src/renderer/lib/compute-output-sanitize';

describe('sanitizeComputeOutputHtml (#243)', () => {
  it('strips <script> tags entirely', () => {
    const out = sanitizeComputeOutputHtml('<b>safe</b><script>alert(1)</script><i>also safe</i>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('<b>safe</b>');
    expect(out).toContain('<i>also safe</i>');
  });

  it('strips <iframe> + <object> + <embed> + <form>', () => {
    const html = `
      <iframe src="evil"></iframe>
      <object data="evil"></object>
      <embed src="evil">
      <form action="x"><input/></form>
    `;
    const out = sanitizeComputeOutputHtml(html);
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<object');
    expect(out).not.toContain('<embed');
    expect(out).not.toContain('<form');
  });

  it('strips inline event-handler attributes', () => {
    const out = sanitizeComputeOutputHtml('<img src=x onerror="alert(1)" /><b onclick="alert(2)">x</b>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert');
    // The non-handler attrs / tag content survive.
    expect(out).toContain('<b>x</b>');
  });

  it('preserves common _repr_html_ shapes (tables, spans with class)', () => {
    const html = '<table class="dataframe"><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
    const out = sanitizeComputeOutputHtml(html);
    expect(out).toContain('<table');
    expect(out).toContain('<thead');
    expect(out).toContain('<tbody');
    expect(out).toContain('class="dataframe"');
    expect(out).toContain('1');
  });

  it('preserves SVG <circle>/<rect> for _repr_svg_ rendering', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="3"/><rect x="0" y="0" width="10" height="10"/></svg>';
    const out = sanitizeComputeOutputHtml(svg);
    expect(out).toContain('<circle');
    expect(out).toContain('<rect');
  });

  it('strips <script> embedded inside an SVG (XSS via SVG)', () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle cx="5" cy="5" r="3"/></svg>';
    const out = sanitizeComputeOutputHtml(evil);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('<circle');
  });
});
