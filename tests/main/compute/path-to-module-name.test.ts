/**
 * Path → Python module name conversion (#529).
 *
 * The kernel auto-invalidate watcher converts a project-relative `.py`
 * path into the dotted name Python uses in `sys.modules`. This test
 * locks in the conversion rules so we don't regress the edge cases
 * (POSIX/Windows separators, packages, invalid identifiers).
 */

import { describe, it, expect } from 'vitest';
import { pathToModuleName } from '../../../src/main/compute/python-kernel';

describe('pathToModuleName (#529)', () => {
  it('drops .py for a top-level module', () => {
    expect(pathToModuleName('helpers.py')).toBe('helpers');
  });

  it('joins directory segments with dots', () => {
    expect(pathToModuleName('python/utils.py')).toBe('python.utils');
    expect(pathToModuleName('a/b/c.py')).toBe('a.b.c');
  });

  it('normalises backslashes to dots (Windows-style paths)', () => {
    expect(pathToModuleName('python\\utils.py')).toBe('python.utils');
  });

  it('strips a leading ./', () => {
    expect(pathToModuleName('./helpers.py')).toBe('helpers');
  });

  it('treats __init__.py as the parent package', () => {
    expect(pathToModuleName('mypkg/__init__.py')).toBe('mypkg');
    expect(pathToModuleName('a/b/__init__.py')).toBe('a.b');
  });

  it('returns null for non-.py files', () => {
    expect(pathToModuleName('README.md')).toBeNull();
    expect(pathToModuleName('data.csv')).toBeNull();
    expect(pathToModuleName('notes/x.md')).toBeNull();
  });

  it('returns null for paths with non-identifier segments', () => {
    // Leading digit — invalid Python identifier; Python wouldn't have
    // imported it as a module anyway, so we skip rather than emit
    // a bogus sys.modules key.
    expect(pathToModuleName('2024/notes.py')).toBeNull();
    expect(pathToModuleName('my-helper.py')).toBeNull();
    expect(pathToModuleName('with space.py')).toBeNull();
  });

  it('handles a bare __init__.py (project root package — unusual)', () => {
    // Stripping `__init__.py` from a top-level path leaves no segments
    // — there's no parent package to name, so we drop it.
    expect(pathToModuleName('__init__.py')).toBeNull();
  });

  it('is case-insensitive on the .py extension', () => {
    // Windows users sometimes get `.PY`; chokidar surfaces the
    // filesystem case so we accept either.
    expect(pathToModuleName('helpers.PY')).toBe('helpers');
  });
});
