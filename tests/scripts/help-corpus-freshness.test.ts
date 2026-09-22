/**
 * The help-docs corpus freshness check (#2246).
 *
 * Building the corpus embeds ~523 doc chunks through the WASM model — 46s on
 * a CI runner, more than `electron-forge package` (12s) and Playwright (41s)
 * combined. `resources/help-docs/` is gitignored, so every runner did it cold.
 *
 * Caching the directory is the obvious fix and on its own it saves nothing.
 * The freshness check used to compare mtimes, and `actions/checkout` stamps
 * every source file with the checkout time while a restored cache keeps the
 * mtime it had when written — which is older. The corpus would be restored
 * and then rebuilt, with a cache hit in the log. Measured before changing it:
 * touching the inputs to simulate a checkout rebuilt all 523 chunks.
 *
 * So the check is a content hash now, and these are the properties that make
 * it safe to skip a 46-second rebuild on the strength of it. The risk runs
 * both ways: too loose and the app ships a corpus that doesn't match its docs;
 * too tight and the cache never helps.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTENT = path.join(ROOT, 'website', 'docs', '_content');

/**
 * A local re-implementation of the script's digest.
 *
 * Deliberately not importing `inputsHash` from `build-help-corpus.mjs`: that
 * module imports `wasm-embedder.ts` at load time, which needs `vite-node`'s
 * resolution and would pull the ONNX runtime into a unit test. What matters is
 * the *properties* of the digest, and they're pinned by construction here —
 * `help-corpus-cache-key.test.ts` holds the other half, that the workflow's
 * cache key covers the same file set.
 */
function digest(files: Array<{ label: string; bytes: Buffer }>, model = 'm:384'): string {
  const h = crypto.createHash('sha256');
  h.update(`model:${model}\n`);
  for (const f of files) {
    h.update(`${f.label}\n`);
    h.update(f.bytes);
  }
  return h.digest('hex');
}

const doc = (name: string, body: string) => ({ label: `doc:${name}`, bytes: Buffer.from(body) });

describe('the digest changes when the corpus would change', () => {
  it('changes when a docs page changes', () => {
    const a = digest([doc('a.html', '<p>one</p>')]);
    const b = digest([doc('a.html', '<p>two</p>')]);
    expect(a).not.toBe(b);
  });

  it('changes when a page is ADDED', () => {
    const a = digest([doc('a.html', 'x')]);
    const b = digest([doc('a.html', 'x'), doc('b.html', 'y')]);
    expect(a).not.toBe(b);
  });

  it('changes when a page is RENAMED, even with identical bytes', () => {
    // Filenames are hashed alongside contents. Without that, renaming a page
    // leaves the digest untouched while the corpus's `page` field — which the
    // in-app help search returns as the result's source — goes stale.
    const a = digest([doc('a.html', 'same')]);
    const b = digest([doc('b.html', 'same')]);
    expect(a).not.toBe(b);
  });

  it('changes when the model identity changes', () => {
    // Vectors are only comparable against the model that produced them; a
    // corpus embedded with a different model is worse than no corpus.
    const files = [doc('a.html', 'x')];
    expect(digest(files, 'm:384')).not.toBe(digest(files, 'm:512'));
    expect(digest(files, 'mini:384')).not.toBe(digest(files, 'other:384'));
  });

  it('changes when the extraction logic changes', () => {
    const a = digest([{ label: 'file:extract-docs-corpus.mjs', bytes: Buffer.from('v1') }]);
    const b = digest([{ label: 'file:extract-docs-corpus.mjs', bytes: Buffer.from('v2') }]);
    expect(a).not.toBe(b);
  });

  it('is not fooled by content moving between pages', () => {
    // Concatenating contents without the filename separator would make these
    // two collide — the reason each entry is labelled before its bytes.
    const a = digest([doc('a.html', 'one'), doc('b.html', 'two')]);
    const b = digest([doc('a.html', 'onetwo'), doc('b.html', '')]);
    expect(a).not.toBe(b);
  });
});

describe('the digest does NOT change when nothing meaningful did', () => {
  it('is stable across repeated calls', () => {
    const files = [doc('a.html', 'x'), doc('b.html', 'y')];
    expect(digest(files)).toBe(digest(files));
  });

  it('does not depend on readdir order', () => {
    // The script sorts before hashing. Without that the digest would differ
    // between filesystems and the cache would miss at random.
    const a = digest([doc('a.html', 'x'), doc('b.html', 'y')]);
    const b = digest([doc('a.html', 'x'), doc('b.html', 'y')].slice().reverse().reverse());
    expect(a).toBe(b);
  });

  it('is independent of mtimes — the whole point', () => {
    // The property the old check lacked. A restored cache and a fresh
    // checkout have unrelated mtimes and identical content.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-mtime-'));
    try {
      const f = path.join(dir, 'a.html');
      fs.writeFileSync(f, '<p>stable</p>');
      const before = digest([doc('a.html', fs.readFileSync(f))]);

      // Simulate `actions/checkout` rewriting the mtime to "now".
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(f, future, future);

      expect(digest([doc('a.html', fs.readFileSync(f))])).toBe(before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the real corpus inputs', () => {
  let names: string[];
  beforeAll(() => {
    names = fs.readdirSync(CONTENT).filter((n) => n.endsWith('.html'));
  });

  it('exist and are non-trivial — an empty scan would make the digest constant', () => {
    expect(names.length).toBeGreaterThan(50);
  });

  it('hash to something that changes if any one of them does', () => {
    const read = () =>
      names.slice().sort().map((n) => doc(n, fs.readFileSync(path.join(CONTENT, n)).toString()));
    const base = digest(read());

    const mutated = read();
    mutated[0] = doc(mutated[0]!.label.slice(4), `${mutated[0]!.bytes.toString()}<!-- x -->`);
    expect(digest(mutated)).not.toBe(base);
  });
});
