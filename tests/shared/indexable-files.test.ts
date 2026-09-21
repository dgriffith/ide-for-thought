/**
 * `isIndexable`, which moved from `main/notebase/` to `shared/` in #2238 to
 * break the `graph → notebase` package edge.
 *
 * The move cost it `node:path`: `src/shared` is lint-enforced pure (no Node
 * builtins, #668) because the renderer imports from here. So `path.basename`
 * and `path.extname` became string work — and the differential suite at the
 * bottom is what makes that a refactor rather than a rewrite, by running the
 * pure version against the real `node:path` over the inputs where the two
 * could plausibly disagree.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { isIndexable, INDEXABLE_EXTS } from '../../src/shared/indexable-files';
import { THOUGHTBASE_DOC_FILENAME } from '../../src/shared/thoughtbase';

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

/**
 * The de-Node-ing, checked rather than asserted (#2238).
 *
 * `path.extname` has behaviour nobody remembers until it bites: a leading dot
 * is part of the NAME (`.gitignore` has no extension), a trailing dot IS an
 * extension (`'.'`), and only the last dot counts. A hand-rolled
 * `split('.').pop()` gets every one of those wrong, and the failure mode is
 * silent — a file quietly stops being indexed.
 */
describe('the pure basename/extname agree with node:path (#2238)', () => {
  const CASES = [
    'notes/idea.md',
    'idea.md',
    'deep/nested/path/idea.md',
    'archive.tar.md',            // multiple dots — last one wins
    '.gitignore',                // leading dot is a name, not an extension
    'notes/.hidden.md',          // leading dot on the BASENAME, with a real ext
    'noext',
    'notes/noext',
    'trailing.',                 // a lone trailing dot IS an extension to node
    'UPPER.MD',                  // case folded by the caller, not the splitter
    'weird.name.with.dots.csv',
    'dir.with.dots/file.md',     // dots in a DIRECTORY must not be read as ext
    'dir.with.dots/noext',
    'windows\\style\\path.md',   // both separators — callers pass either
    'windows\\style\\noext',
    '',
  ];

  it.each(CASES)('matches on %o', (input) => {
    // Re-derive what the module does internally, through the public function:
    // an input is indexable iff node:path would give it an indexable
    // extension and a non-thoughtbase basename.
    const byNode =
      path.basename(input.replace(/\\/g, '/')) !== THOUGHTBASE_DOC_FILENAME &&
      INDEXABLE_EXTS.has(path.extname(input.replace(/\\/g, '/')).toLowerCase());
    expect(isIndexable(input)).toBe(byNode);
  });

  it('still excludes the thoughtbase doc found via either separator', () => {
    expect(isIndexable(`notes/${THOUGHTBASE_DOC_FILENAME}`)).toBe(false);
    expect(isIndexable(`notes\\${THOUGHTBASE_DOC_FILENAME}`)).toBe(false);
  });
});
