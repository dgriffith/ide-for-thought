/**
 * The containment comparison compares canonical spellings (#2990): a root
 * that arrives as `C:/Users/me/tb`, `c:\Users\me\tb` or `/tb` is the same
 * folder as the `path.resolve` output under it, and traversal is refused
 * exactly as before. Windows rules run with `path.win32` injected, on any host.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { isWithinRoot } from '../../src/main/path-containment';

const W = path.win32;

describe('isWithinRoot on Windows spellings (#2990)', () => {
  const root = 'C:\\Users\\me\\tb';
  const inside = 'C:\\Users\\me\\tb\\notes\\a.md';

  it('a root spelled with forward slashes', () => {
    expect(isWithinRoot('C:/Users/me/tb', inside, W)).toBe(true);
  });

  it('a different drive-letter or folder case', () => {
    expect(isWithinRoot('c:\\users\\ME\\tb', inside, W)).toBe(true);
    expect(isWithinRoot(root, 'c:\\USERS\\me\\TB\\notes\\a.md', W)).toBe(true);
  });

  it('the root itself, with or without a trailing separator', () => {
    expect(isWithinRoot(root, root, W)).toBe(true);
    expect(isWithinRoot(`${root}\\`, inside, W)).toBe(true);
    expect(isWithinRoot('C:\\', 'C:\\anything\\x.md', W)).toBe(true);
  });

  it('a sibling that only shares a prefix is outside', () => {
    expect(isWithinRoot(root, 'C:\\Users\\me\\tb-old\\x.md', W)).toBe(false);
    expect(isWithinRoot(root, 'C:\\Users\\me\\tbx', W)).toBe(false);
  });

  it('.. and another drive are outside', () => {
    expect(isWithinRoot(root, 'C:\\Users\\me\\tb\\..\\secret.md', W)).toBe(false);
    expect(isWithinRoot(root, 'D:\\Users\\me\\tb\\a.md', W)).toBe(false);
  });
});

describe('isWithinRoot on POSIX (#2990)', () => {
  const P = path.posix;

  it('keeps case-sensitivity and segment matching', () => {
    expect(isWithinRoot('/home/me/tb', '/home/me/tb/a.md', P)).toBe(true);
    expect(isWithinRoot('/home/me/tb', '/home/me/TB/a.md', P)).toBe(false);
    expect(isWithinRoot('/home/me/tb', '/home/me/tb-old/a.md', P)).toBe(false);
    expect(isWithinRoot('/home/me/tb/', '/home/me/tb/a.md', P)).toBe(true);
    expect(isWithinRoot('/home/me/tb', '/home/me/tb/../x', P)).toBe(false);
  });
});
