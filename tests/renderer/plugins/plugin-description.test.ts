/**
 * @vitest-environment jsdom
 *
 * A plugin's description renders as Markdown in Settings → Plugins, but it's
 * third-party text: no raw HTML, no images, nothing that runs.
 */
import { describe, it, expect } from 'vitest';
import { renderPluginDescription } from '../../../src/renderer/lib/plugins/plugin-description';

describe('renderPluginDescription', () => {
  it('renders Markdown: emphasis, code, lists and links', () => {
    const html = renderPluginDescription('Adds a **board**.\n\n- one\n- `two`\n\nSee [the docs](https://example.org/lab).');
    expect(html).toContain('<strong>board</strong>');
    expect(html).toContain('<li><code>two</code></li>');
    expect(html).toContain('<a href="https://example.org/lab">the docs</a>');
  });

  it('escapes raw HTML rather than rendering it', () => {
    const html = renderPluginDescription('<img src=x onerror="alert(1)"><script>alert(2)</script>');
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('draws no images, so a description fetches nothing', () => {
    expect(renderPluginDescription('![beacon](https://tracker.example/p.gif)')).not.toContain('<img');
  });

  it('makes no link of a javascript: URL', () => {
    expect(renderPluginDescription('[x](javascript:alert(1))')).not.toContain('<a');
  });
});
