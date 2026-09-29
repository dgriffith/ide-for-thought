/**
 * The walker-facing half of the containment guard (#2398): `isEscapingSymlink`
 * and `isContainedPath`, plus `listFiles`' mtime for an escaping link.
 * `assertSafePath` itself is covered by `tests/main/notebase/symlink-escape.test.ts`.
 * Also the agent-path guard (#2453) — `agentPathRefusal` / `assertAgentPath` /
 * `assertBareId` — at the unit level; its tool-level proof is
 * `tests/main/llm/prompt-injection/agent-paths.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isEscapingSymlink,
  isContainedPath,
  canonicalRoot,
  agentPathRefusal,
  assertAgentPath,
  assertBareId,
  AgentPathRefusedError,
} from '../../src/main/path-containment';
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

// ── the agent-path guard (#2453) ────────────────────────────────────────────
describe('agentPathRefusal / assertAgentPath', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(root, '.minerva', 'conversations'), { recursive: true });
    fs.writeFileSync(path.join(root, '.minerva', 'secrets.json'), '{}');
    fs.mkdirSync(path.join(root, 'notes'));
    fs.writeFileSync(path.join(root, 'notes', 'minerva-ideas.md'), '# ideas');
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.symlinkSync(path.join(root, '.minerva'), path.join(root, 'notes', 'state'));
    fs.symlinkSync(path.join(root, '.minerva', 'secrets.json'), path.join(root, 'notes', 'innocent.json'));
    fs.symlinkSync(path.join(root, 'notes', 'minerva-ideas.md'), path.join(root, 'alias.md'));
    fs.symlinkSync(path.join(root, '.minerva', 'missing'), path.join(root, 'notes', 'dangling-in'));
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'leak.md'));
  });

  it.each([
    '.minerva/secrets.json',
    './.minerva/secrets.json',
    'notes/../.minerva/secrets.json',
    '.MINERVA/secrets.json',
    '.minerva\\secrets.json',
    '.minerva',
    '.minerva/conversations/c.json',
    '.git/config',
    'notes/.obsidian/x.json',
    'node_modules/pkg/x.md',
    'NODE_MODULES/pkg/x.md',
    'notes/.hidden.md',
    '../tb/notes/minerva-ideas.md',
    // Symlinks: as spelled, nothing hidden; where they land, `.minerva/`.
    'notes/state/secrets.json',
    'notes/state',
    'notes/innocent.json',
    // Write targets whose tail does not exist yet land there too.
    'notes/state/new.md',
    'notes/state/types/new.md',
    'notes/dangling-in',
  ])('%s is refused as hidden', (p) => {
    expect(agentPathRefusal(root, p)).toBe('hidden');
    expect(() => assertAgentPath(root, p)).toThrow(AgentPathRefusedError);
    expect(() => assertAgentPath(root, p)).toThrow(/hidden or Minerva-internal folder/);
  });

  it.each(['/etc/passwd', 'leak.md'])('%s is refused as outside', (p) => {
    expect(agentPathRefusal(root, p)).toBe('outside');
    expect(() => assertAgentPath(root, p)).toThrow(/not a path inside the thoughtbase/);
  });

  it('an absolute path to a file outside is refused as outside', () => {
    expect(agentPathRefusal(root, path.join(outside, 'secret.md'))).toBe('outside');
  });

  it.each(['.', './', ''])('"%s" names the root and is refused', (p) => {
    expect(() => assertAgentPath(root, p)).toThrow(AgentPathRefusedError);
  });

  it.each([
    'notes/minerva-ideas.md',
    './notes/minerva-ideas.md',
    'alias.md',
    'notes/new-note.md',
    'new-folder/new.md',
    'minerva/notes.md',
    'notes/my.minerva.md',
    '%2Eminerva/secrets.json',
  ])('%s is allowed', (p) => {
    expect(agentPathRefusal(root, p)).toBeNull();
    expect(assertAgentPath(root, p)).toBe(path.resolve(canonicalRoot(root), p));
  });

  it('a root that does not exist yet still answers (its canonical ancestor is compared)', () => {
    const missing = path.join(base, 'not-yet');
    expect(agentPathRefusal(missing, 'notes/a.md')).toBeNull();
    expect(agentPathRefusal(missing, '.minerva/a.md')).toBe('hidden');
  });
});

describe('assertBareId', () => {
  it.each(['abc', 'doi-10.1000_xyz', 'a.b'])('%s is a bare id', (id) => {
    expect(assertBareId(id)).toBe(id);
  });
  it.each(['', '.', '..', '../conversations', 'a/b', 'a\\b', 'x..y', 'a\0b'])('%j is refused', (id) => {
    expect(() => assertBareId(id, 'source_id')).toThrow(/Invalid source_id/);
  });
});
