/**
 * In-project symlinks must not let a thoughtbase path leave the root (#2357).
 *
 * `assertSafePath` used to be purely lexical after realpath'ing the root, so
 * `notes/link → <outside>` made `notes/link/secret` pass the guard while
 * `fs.readFile` / `fs.writeFile` followed the link out. A thoughtbase arrives
 * from zip import, git and folder sync, and the LLM `read_note` tool reads
 * through this guard, so the link is attacker-shaped input.
 *
 * Every fixture lives under `os.tmpdir()`, which on macOS is itself behind
 * /var → /private/var — so each case here also runs against a root whose
 * spelling differs from its realpath, the #352 shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSafePath,
  readFile,
  writeFile,
  readBinaryFile,
  writeBinaryFile,
  fileExists,
  _clearRealRootCacheForTests,
} from '../../../src/main/notebase/fs';
import { readNote } from '../../../src/main/llm/tools/read-note';
import type { ToolContext } from '../../../src/main/llm/tools/types';

const made: string[] = [];

function tempDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}

let root: string;
let outside: string;

beforeEach(() => {
  _clearRealRootCacheForTests();
  root = tempDir('minerva-symlink-root-');
  outside = tempDir('minerva-symlink-outside-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET');
  fs.mkdirSync(path.join(root, 'notes'));
  fs.writeFileSync(path.join(root, 'notes', 'a.md'), '# a');
});

afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('a symlinked DIRECTORY pointing outside the root', () => {
  beforeEach(() => {
    fs.symlinkSync(outside, path.join(root, 'notes', 'link'), 'dir');
  });

  it('refuses a read through it', async () => {
    await expect(readFile(root, 'notes/link/secret.txt')).rejects.toThrow(/traversal/i);
    await expect(readBinaryFile(root, 'notes/link/secret.txt')).rejects.toThrow(/traversal/i);
  });

  it('refuses a write through it, and the outside file is untouched', async () => {
    await expect(writeFile(root, 'notes/link/secret.txt', 'pwned')).rejects.toThrow(/traversal/i);
    await expect(writeBinaryFile(root, 'notes/link/secret.txt', new Uint8Array([1])))
      .rejects.toThrow(/traversal/i);
    expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf-8')).toBe('TOP SECRET');
  });

  it('refuses write-to-create under it (leaf and intermediate dir missing)', async () => {
    await expect(writeFile(root, 'notes/link/new/deep.md', 'x')).rejects.toThrow(/traversal/i);
    expect(fs.existsSync(path.join(outside, 'new'))).toBe(false);
  });

  it('refuses the link itself and an existence probe through it', async () => {
    expect(() => assertSafePath(root, 'notes/link')).toThrow(/traversal/i);
    await expect(fileExists(root, 'notes/link/secret.txt')).rejects.toThrow(/traversal/i);
  });

  it('refuses it via the LLM read_note tool', async () => {
    const ctx = { rootPath: root } as unknown as ToolContext;
    await expect(readNote.run(ctx, { relative_path: 'notes/link/secret.txt' }))
      .rejects.toThrow(/traversal/i);
  });

  it('refuses it when the root is spelled through its realpath too', async () => {
    const realRoot = fs.realpathSync(root);
    await expect(readFile(realRoot, 'notes/link/secret.txt')).rejects.toThrow(/traversal/i);
  });
});

describe('a symlinked FILE pointing outside the root', () => {
  it('refuses reads and writes through it', async () => {
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'notes', 'leak.md'));
    await expect(readFile(root, 'notes/leak.md')).rejects.toThrow(/traversal/i);
    await expect(writeFile(root, 'notes/leak.md', 'pwned')).rejects.toThrow(/traversal/i);
    expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf-8')).toBe('TOP SECRET');
  });

  it('refuses a DANGLING link, which a write would follow to create its target', async () => {
    const target = path.join(outside, 'created-by-write.md');
    fs.symlinkSync(target, path.join(root, 'notes', 'dangling.md'));
    await expect(writeFile(root, 'notes/dangling.md', 'x')).rejects.toThrow(/traversal/i);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses a relative link that climbs out', async () => {
    fs.symlinkSync('../../', path.join(root, 'notes', 'up'));
    // `notes/up` → the root's parent: lexically in, really out.
    const escapeName = path.basename(outside);
    await expect(readFile(root, `notes/up/${escapeName}/secret.txt`)).rejects.toThrow(/traversal/i);
  });

  it('refuses a chain that leaves on its second hop', async () => {
    fs.symlinkSync(outside, path.join(root, 'hop2'), 'dir');
    fs.symlinkSync(path.join(root, 'hop2'), path.join(root, 'notes', 'hop1'), 'dir');
    await expect(readFile(root, 'notes/hop1/secret.txt')).rejects.toThrow(/traversal/i);
  });

  it('refuses a symlink loop rather than hanging', () => {
    fs.symlinkSync(path.join(root, 'loopB'), path.join(root, 'loopA'));
    fs.symlinkSync(path.join(root, 'loopA'), path.join(root, 'loopB'));
    expect(() => assertSafePath(root, 'loopA/x.md')).toThrow(/traversal/i);
  });
});

describe('symlinks that stay inside the root keep working', () => {
  it('reads and writes through an in-root directory link', async () => {
    fs.mkdirSync(path.join(root, 'archive'));
    fs.writeFileSync(path.join(root, 'archive', 'old.md'), '# old');
    fs.symlinkSync(path.join(root, 'archive'), path.join(root, 'notes', 'arc'), 'dir');

    await expect(readFile(root, 'notes/arc/old.md')).resolves.toBe('# old');
    await writeFile(root, 'notes/arc/new.md', '# new');
    expect(fs.readFileSync(path.join(root, 'archive', 'new.md'), 'utf-8')).toBe('# new');
    // Write-to-create in a missing subdir under the in-root link.
    await writeFile(root, 'notes/arc/sub/deeper.md', '# d');
    expect(fs.readFileSync(path.join(root, 'archive', 'sub', 'deeper.md'), 'utf-8')).toBe('# d');
  });

  it('reads through a relative in-root file link', async () => {
    fs.symlinkSync('a.md', path.join(root, 'notes', 'alias.md'));
    await expect(readFile(root, 'notes/alias.md')).resolves.toBe('# a');
  });

  it('allows a dangling link whose target is inside the root, and the write lands there', async () => {
    fs.symlinkSync(path.join(root, 'notes', 'later.md'), path.join(root, 'notes', 'pending.md'));
    await writeFile(root, 'notes/pending.md', '# later');
    expect(fs.readFileSync(path.join(root, 'notes', 'later.md'), 'utf-8')).toBe('# later');
  });

  it('costs no realpath on the hot path when no symlink is involved (#2216)', () => {
    // The symlink check is an lstat walk that only canonicalises when it
    // meets a link, so ordinary reads of existing nested files keep the
    // "one realpath per root" property the root cache exists for.
    fs.mkdirSync(path.join(root, 'notes', 'deep', 'er'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes', 'deep', 'er', 'x.md'), 'x');
    assertSafePath(root, 'notes/a.md'); // warm the root cache
    let n = 0;
    const real = fs.realpathSync;
    const spy = vi.spyOn(fs, 'realpathSync').mockImplementation(((...a: unknown[]) => {
      n += 1;
      return (real as unknown as (...x: unknown[]) => unknown)(...a);
    }) as never);
    try {
      for (let i = 0; i < 200; i++) {
        assertSafePath(root, 'notes/deep/er/x.md');
        assertSafePath(root, 'notes/a.md');
        assertSafePath(root, `notes/new-${i}.md`);
      }
    } finally {
      spy.mockRestore();
    }
    expect(n).toBe(0);
  });

  it('returns the same path as before — the lexical one, through the link', () => {
    fs.mkdirSync(path.join(root, 'archive'));
    fs.symlinkSync(path.join(root, 'archive'), path.join(root, 'notes', 'arc'), 'dir');
    expect(assertSafePath(root, 'notes/arc/x.md'))
      .toBe(path.join(fs.realpathSync(root), 'notes', 'arc', 'x.md'));
  });
});
