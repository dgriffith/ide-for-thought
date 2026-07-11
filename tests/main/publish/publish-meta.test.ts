/**
 * Per-note publishing frontmatter parse/validation (#1136). Pins the `publish:`
 * namespace, the background-safety allowlist, and css-path safety.
 */
import { describe, it, expect } from 'vitest';
import { extractPublish, isSafeCssColor, hasPublishMeta } from '../../../src/main/publish/exporters/static-site/publish-meta';
import type { ExportPlanFile } from '../../../src/main/publish/types';

const note = (frontmatter: Record<string, unknown>): ExportPlanFile => ({
  relativePath: 'n.md', kind: 'note', title: 'N', frontmatter,
} as ExportPlanFile);

describe('extractPublish (#1136)', () => {
  it('reads the publish: block + top-level description', () => {
    const m = extractPublish(note({
      description: 'A blurb',
      publish: { image: 'https://ex.com/c.png', background: '#faf3e0', css: 'styles/x.css' },
    }));
    expect(m).toEqual({ description: 'A blurb', image: 'https://ex.com/c.png', background: '#faf3e0', cssPaths: ['styles/x.css'] });
  });

  it('drops an unsafe background rather than passing it through', () => {
    expect(extractPublish(note({ publish: { background: 'red; } body { display:none' } })).background).toBeUndefined();
    expect(extractPublish(note({ publish: { background: 'url(javascript:alert(1))' } })).background).toBeUndefined();
    expect(extractPublish(note({ publish: { background: 'rebeccapurple' } })).background).toBe('rebeccapurple');
    expect(extractPublish(note({ publish: { background: 'rgb(10, 20, 30)' } })).background).toBe('rgb(10, 20, 30)');
  });

  it('rejects unsafe / non-relative css paths (traversal, absolute, url)', () => {
    expect(extractPublish(note({ publish: { css: ['ok.css', '../etc/evil.css', '/abs.css', 'https://x/y.css', 'no-ext'] } })).cssPaths)
      .toEqual(['ok.css']);
  });

  it('ignores publish when it is not an object; no keys → empty', () => {
    expect(extractPublish(note({ publish: 'nope' })).cssPaths).toEqual([]);
    expect(hasPublishMeta(extractPublish(note({})))).toBe(false);
    expect(hasPublishMeta(extractPublish(note({ description: 'x' })))).toBe(true);
  });
});

describe('isSafeCssColor', () => {
  it('accepts hex / keyword / rgb / hsl / var; rejects everything else', () => {
    for (const ok of ['#fff', '#ffaa00', '#ffaa00cc', 'tomato', 'rgb(1,2,3)', 'hsla(1, 2%, 3%, .4)', 'var(--accent)']) {
      expect(isSafeCssColor(ok), ok).toBe(true);
    }
    for (const bad of ['red;color:blue', '} x {', 'url(x)', 'expression(1)', '#ggg' + '', '']) {
      expect(isSafeCssColor(bad), bad).toBe(false);
    }
  });
});
