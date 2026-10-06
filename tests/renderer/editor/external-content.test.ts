/**
 * An outside change (a preview resize, #2666) lands in the editor as the
 * smallest edit, so ⌘Z undoes exactly it.
 */
import { describe, it, expect } from 'vitest';
import { minimalChange } from '../../../src/renderer/lib/editor/external-content';

describe('minimalChange', () => {
  it('is null for equal docs', () => {
    expect(minimalChange('abc', 'abc')).toBeNull();
  });
  it('covers only the changed span', () => {
    expect(minimalChange('x ![a](p.png) y', 'x ![a|400](p.png) y')).toEqual({ from: 5, to: 5, insert: '|400' });
    expect(minimalChange('![a|400](p)', '![a](p)')).toEqual({ from: 3, to: 7, insert: '' });
    expect(minimalChange('aaa', 'aaaa')).toEqual({ from: 3, to: 3, insert: 'a' });
  });
});
