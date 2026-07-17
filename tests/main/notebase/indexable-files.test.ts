import { describe, it, expect } from 'vitest';
import { isIndexable } from '../../../src/main/notebase/indexable-files';
import { THOUGHTBASE_DOC_FILENAME } from '../../../src/shared/thoughtbase';

describe('isIndexable', () => {
  it('indexes the first-class note/data extensions', () => {
    expect(isIndexable('notes/idea.md')).toBe(true);
    expect(isIndexable('data.csv')).toBe(true);
    expect(isIndexable('graph.ttl')).toBe(true);
    expect(isIndexable('run.py')).toBe(true);
  });

  it('skips unknown extensions', () => {
    expect(isIndexable('photo.png')).toBe(false);
    expect(isIndexable('notes.txt')).toBe(false);
  });

  it('excludes the thoughtbase guide (meta, not a knowledge node)', () => {
    expect(isIndexable(THOUGHTBASE_DOC_FILENAME)).toBe(false);
    // Excluded by basename, wherever it sits.
    expect(isIndexable('anything/thoughtbase.md')).toBe(false);
    // A differently-named markdown note is still indexed.
    expect(isIndexable('thoughts.md')).toBe(true);
  });
});
