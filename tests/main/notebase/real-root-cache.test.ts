/**
 * `assertSafePath` canonicalises the project root once, not per call (#2216).
 *
 * The guard resolves `relativePath` against `realpathSync(rootPath)` so a
 * project rooted on a symlinked path — notably macOS's `/var` → `/private/var`,
 * where `tmpdir()` lives (#352) — doesn't make an ordinary in-project path look
 * like a traversal. That realpath is the entire cost of the guard: measured at
 * 16.25us against 17.22us for the whole of `assertSafePath`, i.e. 94%.
 *
 * It runs on every file IPC (24 call sites, several in loops) and boot walks
 * the project three to four times, so at 2,000 notes it was ~34ms per pass,
 * several times over, before the window paints — to re-derive a value that
 * cannot change while the project is open.
 *
 * ── Why this file is mostly about correctness ───────────────────────────────
 * `assertSafePath` is the path-traversal guard. A cache that makes it faster
 * and subtly wrong is a security regression, not a performance win, so the
 * syscall-count gate below is deliberately outnumbered by tests asserting that
 * the guard still refuses everything it refused before — including with the
 * cache warm, which is the state a real attacker would meet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSafePath,
  _clearRealRootCacheForTests,
} from '../../../src/main/notebase/fs';

const made: string[] = [];

function tempRoot(): string {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'minerva-realroot-'));
  made.push(dir);
  return dir;
}

/** Count `realpathSync` calls while `fn` runs. */
function countRealpath(fn: () => void): number {
  let n = 0;
  const real = fsSync.realpathSync;
  const spy = vi.spyOn(fsSync, 'realpathSync').mockImplementation(((...a: unknown[]) => {
    n += 1;
    return (real as unknown as (...x: unknown[]) => unknown)(...a);
  }) as never);
  try {
    fn();
    return n;
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => { _clearRealRootCacheForTests(); });
afterEach(() => {
  for (const d of made.splice(0)) fsSync.rmSync(d, { recursive: true, force: true });
});

describe('the syscall happens once per root (#2216)', () => {
  it('2,000 checks against one root cost one realpath', () => {
    const root = tempRoot();
    const calls = countRealpath(() => {
      for (let i = 0; i < 2000; i++) assertSafePath(root, `notes/n${i}.md`);
    });
    expect(calls, 'the root was re-canonicalised per call').toBe(1);
  });

  it('every one of those checks still returns the right path', () => {
    // The count gate above is satisfied by a guard that stops resolving at
    // all. Each call must still produce the same answer an uncached one would.
    const root = tempRoot();
    const realRoot = fsSync.realpathSync(root);
    for (let i = 0; i < 5; i++) {
      expect(assertSafePath(root, `notes/n${i}.md`))
        .toBe(path.join(realRoot, 'notes', `n${i}.md`));
    }
  });

  it('two open projects are both cached', () => {
    const a = tempRoot();
    const b = tempRoot();
    assertSafePath(a, 'x.md');
    assertSafePath(b, 'x.md');
    const calls = countRealpath(() => {
      for (let i = 0; i < 50; i++) {
        assertSafePath(a, 'x.md');
        assertSafePath(b, 'x.md');
      }
    });
    expect(calls, 'a second open project evicted the first on every call').toBe(0);
  });

  it('degrades to the syscall past the cache size, never to a wrong answer', () => {
    // The bound is the point: this is a fixed-size ring, not per-project state
    // owed a teardown. More roots than it holds must still be CORRECT.
    const roots = Array.from({ length: 6 }, () => tempRoot());
    for (const r of roots) {
      expect(assertSafePath(r, 'a.md')).toBe(path.join(fsSync.realpathSync(r), 'a.md'));
    }
    // Re-checking the oldest is still right whether or not it was evicted.
    expect(assertSafePath(roots[0]!, 'a.md'))
      .toBe(path.join(fsSync.realpathSync(roots[0]!), 'a.md'));
  });

  it('actually evicts — the cache is bounded, not merely described as bounded', () => {
    // Added because the test above does NOT fail if the bound is removed: an
    // unbounded cache is still correct, just unbounded, and the module comment
    // claims boundedness as the reason this is not per-project state owed a
    // teardown (#2240). So assert the claim directly: fill past the size, then
    // show the oldest root has to be canonicalised again.
    const roots = Array.from({ length: 6 }, () => tempRoot());
    for (const r of roots) assertSafePath(r, 'a.md');

    const evicted = countRealpath(() => { assertSafePath(roots[0]!, 'a.md'); });
    expect(evicted, 'the cache never evicts, so it grows without bound').toBe(1);

    // …while the most recent root is still warm, so eviction is by age rather
    // than a cache that simply never retains anything.
    const warm = countRealpath(() => { assertSafePath(roots[5]!, 'a.md'); });
    expect(warm, 'the newest root was not retained').toBe(0);
  });
});

describe('the guard still refuses what it refused before', () => {
  it('blocks a parent-directory escape — warm cache', () => {
    // Warm on purpose: a cold-cache-only test would miss a cache that returns
    // a root the traversal check then compares against incorrectly.
    const root = tempRoot();
    assertSafePath(root, 'seed.md');
    expect(() => assertSafePath(root, '../escape.md')).toThrow(/traversal/i);
    expect(() => assertSafePath(root, 'notes/../../escape.md')).toThrow(/traversal/i);
  });

  it('blocks an absolute path outside the root — warm cache', () => {
    const root = tempRoot();
    assertSafePath(root, 'seed.md');
    expect(() => assertSafePath(root, '/etc/passwd')).toThrow(/traversal/i);
  });

  it('allows the root itself and a nested path — warm cache', () => {
    const root = tempRoot();
    assertSafePath(root, 'seed.md');
    expect(() => assertSafePath(root, '.')).not.toThrow();
    expect(() => assertSafePath(root, 'a/b/c/deep.md')).not.toThrow();
  });

  it('still resolves a SYMLINKED root — the #352 case the realpath exists for', () => {
    // If the memo ever returned the un-canonicalised root, this is what would
    // break: every ordinary path under a symlinked project would read as a
    // traversal. `tmpdir()` on macOS is itself behind /var → /private/var,
    // so an explicit symlink here makes the case regardless of platform.
    const target = tempRoot();
    const link = path.join(path.dirname(target), `${path.basename(target)}-link`);
    fsSync.symlinkSync(target, link, 'dir');
    made.push(link);

    const resolved = assertSafePath(link, 'notes/a.md');
    expect(resolved).toBe(path.join(fsSync.realpathSync(target), 'notes', 'a.md'));
    // And again, warm.
    expect(assertSafePath(link, 'notes/a.md')).toBe(resolved);
    expect(() => assertSafePath(link, '../outside.md')).toThrow(/traversal/i);
  });

  it('a root that does not exist yet still works, and is not poisoned by caching', () => {
    // `realPathSafe` falls back to the input for a not-yet-created project.
    // Caching that fallback must not stop the real path being used once the
    // directory appears — so the fallback is checked, then the same root is
    // created and re-checked through a cleared cache, the way a fresh process
    // would see it.
    const parent = tempRoot();
    const notYet = path.join(parent, 'unborn');
    expect(assertSafePath(notYet, 'a.md')).toBe(path.join(notYet, 'a.md'));
    expect(() => assertSafePath(notYet, '../../escape.md')).toThrow(/traversal/i);

    fsSync.mkdirSync(notYet);
    _clearRealRootCacheForTests();
    expect(assertSafePath(notYet, 'a.md'))
      .toBe(path.join(fsSync.realpathSync(notYet), 'a.md'));
  });
});
