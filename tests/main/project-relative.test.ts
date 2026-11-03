import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { projectRelative } from '../../src/main/path-containment';

describe('projectRelative (#2989)', () => {
  it('is /-separated on Windows', () => {
    expect(projectRelative('C:\\Users\\me\\tb', 'C:\\Users\\me\\tb\\notes\\sub\\a.md', path.win32)).toBe('notes/sub/a.md');
  });

  it('is unchanged on POSIX', () => {
    expect(projectRelative('/home/me/tb', '/home/me/tb/notes/sub/a.md', path.posix)).toBe('notes/sub/a.md');
  });

  it('a private/** exclusion matches what it produces on either OS', () => {
    const win = projectRelative('C:\\tb', 'C:\\tb\\private\\secret.md', path.win32);
    expect(win.startsWith('private/')).toBe(true);
  });

  it('the root itself is the empty string, and an outside path keeps its ..', () => {
    expect(projectRelative('C:\\tb', 'C:\\tb', path.win32)).toBe('');
    expect(projectRelative('C:\\tb', 'C:\\elsewhere\\x.md', path.win32)).toBe('../elsewhere/x.md');
  });
});
