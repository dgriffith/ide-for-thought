/**
 * The walker-facing half of the containment guard (#2398): `isEscapingSymlink`
 * and `isContainedPath`, plus `listFiles`' mtime for an escaping link.
 * `assertSafePath` itself is covered by `tests/main/notebase/symlink-escape.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isEscapingSymlink, isContainedPath, canonicalRoot } from '../../src/main/path-containment';
import { listFiles } from '../../src/main/notebase/fs';

let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-containment-'));
  root = path.join(base, 'tb');
  outside = path.join(base, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret');
  fs.writeFileSync(path.join(root, 'real.md'), 'real');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(base, { recursive: true, force: true });
});

function direntOf(abs: string): fs.Dirent {
  const d = fs.readdirSync(path.dirname(abs), { withFileTypes: true }).find((e) => e.name === path.basename(abs));
  if (!d) throw new Error(`no dirent for ${abs}`);
  return d;
}

describe('isEscapingSymlink', () => {
  it('is true for a link whose target is outside the root', () => {
    const p = path.join(root, 'leak.md');
    fs.symlinkSync(path.join(outside, 'secret.md'), p);
    expect(isEscapingSymlink(root, p, direntOf(p))).toBe(true);
  });

  it('is true for a dangling link whose target would be outside the root', () => {
    const p = path.join(root, 'dangling.md');
    fs.symlinkSync(path.join(outside, 'missing.md'), p);
    expect(isEscapingSymlink(root, p, direntOf(p))).toBe(true);
  });

  it('is true for a chain that ends outside (in-root link -> in-root link -> outside)', () => {
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'hop.md'));
    const p = path.join(root, 'chain.md');
    fs.symlinkSync('hop.md', p);
    expect(isEscapingSymlink(root, p, direntOf(p))).toBe(true);
  });

  it('is false for a link that stays inside the root, absolute or relative', () => {
    const abs = path.join(root, 'abs.md');
    const rel = path.join(root, 'rel.md');
    fs.symlinkSync(path.join(root, 'real.md'), abs);
    fs.symlinkSync('real.md', rel);
    expect(isEscapingSymlink(root, abs, direntOf(abs))).toBe(false);
    expect(isEscapingSymlink(root, rel, direntOf(rel))).toBe(false);
  });

  it('is false for a regular file without touching the filesystem', () => {
    const p = path.join(root, 'real.md');
    const dirent = direntOf(p);
    const lstat = vi.spyOn(fs, 'lstatSync');
    const realpath = vi.spyOn(fs, 'realpathSync');
    expect(isEscapingSymlink(root, p, dirent)).toBe(false);
    expect(lstat).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
  });

  it('works when the root itself is reached through a symlink', () => {
    const linkedRoot = path.join(base, 'linked-tb');
    fs.symlinkSync(root, linkedRoot);
    const inside = path.join(linkedRoot, 'in.md');
    const leak = path.join(linkedRoot, 'leak.md');
    fs.symlinkSync('real.md', inside);
    fs.symlinkSync(path.join(outside, 'secret.md'), leak);
    expect(isEscapingSymlink(linkedRoot, inside, direntOf(inside))).toBe(false);
    expect(isEscapingSymlink(linkedRoot, leak, direntOf(leak))).toBe(true);
    expect(canonicalRoot(linkedRoot)).toBe(fs.realpathSync(root));
  });
});

describe('isContainedPath', () => {
  it('rejects a path under a symlinked directory that leaves the root', () => {
    fs.symlinkSync(outside, path.join(root, 'out'));
    expect(isContainedPath(root, path.join(root, 'out', 'secret.md'))).toBe(false);
    expect(isContainedPath(root, path.join(root, 'real.md'))).toBe(true);
  });
});

describe('listFiles and escaping links (#2398)', () => {
  it("stamps an escaping link with the link's own mtime, not the outside file's", async () => {
    const old = new Date('2001-01-01T00:00:00Z');
    fs.utimesSync(path.join(outside, 'secret.md'), old, old);
    fs.utimesSync(path.join(root, 'real.md'), old, old);
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'leak.md'));
    fs.symlinkSync('real.md', path.join(root, 'alias.md'));

    const files = await listFiles(root);
    const byName = new Map(files.map((f) => [f.name, f]));

    // Still listed: it is a file the user put in the folder.
    expect(byName.get('leak.md')?.mtimeMs).toBe(fs.lstatSync(path.join(root, 'leak.md')).mtimeMs);
    expect(byName.get('leak.md')?.mtimeMs).not.toBe(old.getTime());
    // An in-root link keeps showing its target's time, as before.
    expect(byName.get('alias.md')?.mtimeMs).toBe(old.getTime());
  });
});
