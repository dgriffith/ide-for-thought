/**
 * A type's `color:` must be only a colour (#2561).
 */
import { describe, it, expect } from 'vitest';
import { safeCssColor } from '../../src/shared/css-color';

describe('safeCssColor (#2561)', () => {
  it('accepts hex, named and rgb/hsl colours', () => {
    for (const c of ['#89b4fa', '#fff', '#ffffff80', 'teal', 'rebeccapurple', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(210 50% 40%)', 'hsla(210, 50%, 40%, .5)', 'rgb(1 2 3 / 50%)']) {
      expect(safeCssColor(c), c).toBe(c);
    }
    expect(safeCssColor('  teal  ')).toBe('teal');
  });

  it('rejects anything that could carry more CSS or break out of the attribute', () => {
    for (const c of [
      'red;background:url(https://t.example/b)',
      'red; position: fixed; inset: 0',
      'red" onmouseover="alert(1)',
      'url(https://t.example/b)',
      'var(--accent)',
      'rgb(1,2,3);display:none',
      'expression(alert(1))',
      '#12345678901',
      '',
      'red blue',
    ]) {
      expect(safeCssColor(c), c).toBeUndefined();
    }
    expect(safeCssColor(undefined)).toBeUndefined();
    expect(safeCssColor(null)).toBeUndefined();
  });
});
