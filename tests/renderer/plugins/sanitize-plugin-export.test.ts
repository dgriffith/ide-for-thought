/**
 * @vitest-environment jsdom
 *
 * A plugin's export HTML (#2828, D4): static, URL-free, with links to notes
 * only the way the app's own views make them.
 */
import { describe, it, expect } from 'vitest';
import { sanitizePluginExportHtml as clean } from '../../../src/renderer/lib/plugins/sanitize-plugin-export';

describe('sanitizePluginExportHtml (#2828)', () => {
  it('keeps the static board: structure, classes, inline styles, note paths, fragment links', () => {
    const html = '<section class="kb-col" style="color: var(--text); display:flex"><h3>Done</h3>'
      + '<ul><li data-note-path="tasks/a.md" class="kb-card">Fix the gate</li></ul><a href="#top">Top</a></section>';
    expect(clean(html)).toBe(html);
  });

  it('drops script, handlers, styles, forms, controls, frames and embeds', () => {
    const out = clean('<div onclick="steal()">x<script>steal()</script><style>body{display:none}</style>'
      + '<form action="https://evil"><input value=1><button>b</button></form><iframe src="https://evil"></iframe>'
      + '<object data="x"></object><svg><use href="https://evil#a"/><foreignObject><p>y</p></foreignObject></svg></div>');
    for (const bad of ['onclick', '<script', '<style', '<form', '<input', '<button', '<iframe', '<object', '<use', 'foreignObject', 'evil']) {
      expect(out, bad).not.toContain(bad);
    }
    expect(out).toContain('x');
  });

  it('loads nothing: no image, no URL attribute, no url() in a style', () => {
    const out = clean('<img src="https://evil/beacon.png"><p style="background: url(https://evil/b.png); color: red">p</p>'
      + '<a href="https://evil/?leak">l</a><a href="javascript:steal()">j</a><div style="background-image:image-set(\'https://evil\' 1x)">d</div>'
      + '<video poster="https://evil"></video><p data-minerva-image="1" data-src="https://evil">q</p>');
    expect(out).not.toMatch(/evil|javascript:|url\(|image-set|<img|<video|data-minerva-image|data-src/);
    expect(out).toContain('color: red');
    expect(out).toContain('>l</a>');
  });

  it('answers nothing for nothing', () => {
    expect(clean('')).toBe('');
  });
});
