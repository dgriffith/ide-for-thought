/**
 * Type-catalog parse memoization (#2225).
 *
 * `api.types.list()` re-ran the whole catalog load on every call — 10 stock
 * YAML parses plus a read+parse per user type — and the callers are not rare
 * (the Objects panel, the New Note dialog, the type picker, the editor's `/type`
 * completion, and `objectTypesStore.refresh()` on EVERY proposal change).
 * Measured cold, on this machine: 1.37ms/call with no user types, 2.47ms with
 * 10, 23.3ms with 200.
 *
 * The fix memoizes the *parse* and deliberately keeps the *walk*, so these
 * tests come in two halves and both halves matter:
 *
 *  - **Count-based** assertions (#2229 — counts, not timings) that the redundant
 *    parses are actually gone.
 *  - **Freshness** assertions that the catalog still reflects what is on disk
 *    right now, which is the property that made reading `GraphState.typeCatalog`
 *    the wrong fix. Nothing watches `.minerva/types/`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { loadTypeCatalog, _clearTypeParseCachesForTests } from '../../../src/main/types/loader';

let root: string;

function typesDir(): string {
  return path.join(root, '.minerva', 'types');
}

function writeUserType(name: string, content: string): void {
  fs.mkdirSync(typesDir(), { recursive: true });
  fs.writeFileSync(path.join(typesDir(), name), content, 'utf-8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-typecache-'));
  // Observe a cold process. Correctness never needs this — the memos are keyed
  // on immutable build-time input and on file content — but the parse COUNTS
  // are only meaningful from a known-cold start.
  _clearTypeParseCachesForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

/** YAML.parse is the one call `parseType` cannot avoid, so counting it counts
 *  parses without mocking the loader's own direct import binding. */
async function countYamlParses(fn: () => Promise<unknown>): Promise<number> {
  const spy = vi.spyOn(YAML, 'parse');
  await fn();
  const n = spy.mock.calls.length;
  spy.mockRestore();
  return n;
}

describe('stock types are parsed once per process (#2225)', () => {
  it('parses the bundled set on the first load and zero times after', async () => {
    const first = await countYamlParses(() => loadTypeCatalog(root));
    expect(first).toBeGreaterThanOrEqual(6); // the bundled stock set

    const second = await countYamlParses(() => loadTypeCatalog(root));
    expect(second).toBe(0);

    // A different project pays nothing either — the stock set is build-time
    // immutable, not per-project.
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-typecache-2-'));
    try {
      expect(await countYamlParses(() => loadTypeCatalog(otherRoot))).toBe(0);
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it('still returns the full, correct stock catalog from the memo', async () => {
    await loadTypeCatalog(root); // prime
    const cat = await loadTypeCatalog(root);
    const book = cat.types.find((t) => t.id === 'book');
    expect(book).toBeDefined();
    expect(book!.label).toBe('Book');
    expect(book!.classLocalName).toBe('Book');
    expect(book!.source).toBe('stock');
    expect(book!.properties.map((p) => p.name)).toContain('author');
  });

  it('hands every caller its own TypeDef instances, never the memo itself', async () => {
    // `loadTypeCatalog` mutates the defs it is given (the parent pass clears a
    // dangling `parent` in place) and callers park the result on
    // `GraphState.typeCatalog`. Sharing one instance across projects would let
    // one thoughtbase edit another's catalog.
    const a = await loadTypeCatalog(root);
    const b = await loadTypeCatalog(root);
    const bookA = a.types.find((t) => t.id === 'book')!;
    const bookB = b.types.find((t) => t.id === 'book')!;
    expect(bookA).not.toBe(bookB);
    expect(bookA.properties).not.toBe(bookB.properties);

    bookA.label = 'MUTATED';
    bookA.properties.push({ name: 'injected', type: 'text' });
    const c = await loadTypeCatalog(root);
    const bookC = c.types.find((t) => t.id === 'book')!;
    expect(bookC.label).toBe('Book');
    expect(bookC.properties.map((p) => p.name)).not.toContain('injected');
  });
});

describe('user types: the disk walk still runs on every call (#2225)', () => {
  it('re-reads the directory and every file each time', async () => {
    writeUserType('recipe.md', `---\nlabel: Recipe\nproperties: []\n---\n`);
    await loadTypeCatalog(root); // prime both memos

    const readdir = vi.spyOn(fsp, 'readdir');
    const readFile = vi.spyOn(fsp, 'readFile');
    await loadTypeCatalog(root);
    expect(readdir).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('skips the YAML parse when the bytes are unchanged', async () => {
    writeUserType('recipe.md', `---\nlabel: Recipe\nproperties: []\n---\n`);
    await loadTypeCatalog(root); // prime
    expect(await countYamlParses(() => loadTypeCatalog(root))).toBe(0);
  });

  it('sees a type file added between calls', async () => {
    // Prime with a type already present, so the directory has a populated memo
    // on the second call — a per-directory cache that short-circuits the walk
    // would pass a version of this test that started from an empty dir.
    writeUserType('gadget.md', `---\nlabel: Gadget\nproperties: []\n---\n`);
    const before = await loadTypeCatalog(root);
    expect(before.types.some((t) => t.id === 'gadget')).toBe(true);
    expect(before.types.some((t) => t.id === 'recipe')).toBe(false);

    writeUserType('recipe.md', `---\nlabel: Recipe\nproperties: []\n---\n`);
    const after = await loadTypeCatalog(root);
    expect(after.types.find((t) => t.id === 'recipe')?.label).toBe('Recipe');
    expect(after.types.some((t) => t.id === 'gadget')).toBe(true);
  });

  it('re-parses a type file EDITED in place, and the new content wins', async () => {
    // The staleness trap an mtime/size key would have to reason about, and the
    // reason the memo is keyed on content instead.
    writeUserType('recipe.md', `---\nlabel: Recipe\nicon: A\nproperties: []\n---\n`);
    expect((await loadTypeCatalog(root)).types.find((t) => t.id === 'recipe')?.icon).toBe('A');

    writeUserType('recipe.md', `---\nlabel: Recipe\nicon: B\nproperties: []\n---\n`);
    const parses = await countYamlParses(async () => {
      const cat = await loadTypeCatalog(root);
      expect(cat.types.find((t) => t.id === 'recipe')?.icon).toBe('B');
    });
    expect(parses).toBe(1); // exactly the changed file, and nothing else
  });

  it('drops a type file deleted between calls', async () => {
    writeUserType('recipe.md', `---\nlabel: Recipe\nproperties: []\n---\n`);
    expect((await loadTypeCatalog(root)).types.some((t) => t.id === 'recipe')).toBe(true);

    fs.rmSync(path.join(typesDir(), 'recipe.md'));
    expect((await loadTypeCatalog(root)).types.some((t) => t.id === 'recipe')).toBe(false);
  });

  it('re-reports a malformed type\'s error on every call, not just the first', async () => {
    writeUserType('bad.md', `no frontmatter here`);
    const first = await loadTypeCatalog(root);
    expect(first.errors.some((e) => e.source === 'user')).toBe(true);
    const second = await loadTypeCatalog(root);
    expect(second.errors.some((e) => e.source === 'user')).toBe(true);
  });

  it('does not let one call\'s parent-clearing leak into the next', async () => {
    // `monograph.md`'s bytes never change, so it is a cache hit on calls 2 and
    // 3. Call 2 finds `reference` missing and CLEARS `parent` on the def it
    // returns; call 3 must still see the declared parent once the target is
    // back. Without a per-call copy, the clear lands on the memo and `parent`
    // is gone for the life of the process.
    writeUserType('reference.md', `---\nlabel: Reference\n---\n`);
    writeUserType('monograph.md', `---\nlabel: Monograph\nparent: reference\n---\n`);
    expect((await loadTypeCatalog(root)).types.find((t) => t.id === 'monograph')?.parent).toBe('reference');

    fs.rmSync(path.join(typesDir(), 'reference.md'));
    const orphaned = await loadTypeCatalog(root);
    expect(orphaned.types.find((t) => t.id === 'monograph')?.parent).toBeUndefined();
    expect(orphaned.errors.some((e) => /parent type "reference" does not exist/.test(e.message))).toBe(true);

    writeUserType('reference.md', `---\nlabel: Reference\n---\n`);
    const restored = await loadTypeCatalog(root);
    expect(restored.types.find((t) => t.id === 'monograph')?.parent).toBe('reference');
  });

  it('keeps a stock override working across cached calls', async () => {
    writeUserType('book.md', `---\nlabel: Book\nid: book\nicon: X\nproperties: []\n---\n`);
    for (const _ of [0, 1, 2]) {
      const cat = await loadTypeCatalog(root);
      const books = cat.types.filter((t) => t.id === 'book');
      expect(books).toHaveLength(1);
      expect(books[0]!.icon).toBe('X');
      expect(books[0]!.overridesStock).toBe(true);
    }
  });
});
