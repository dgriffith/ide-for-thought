/**
 * Tutorial-thoughtbase install mechanism (#1542, epic #1518).
 *
 * Covers the Electron-free copy core: it copies the bundled tree verbatim, and
 * — the load-bearing invariant — NEVER mutates an existing directory in place,
 * suffixing ` 2`, ` 3`… so a re-install always yields a clean copy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  installTutorialThoughtbase,
  firstAvailableDir,
} from '../../../src/main/notebase/install-tutorial';

let workdir: string;
let source: string;

beforeEach(async () => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tutorial-test-'));
  // A stand-in bundled tree with a nested file, to prove recursion.
  source = path.join(workdir, 'bundled');
  await fsp.mkdir(path.join(source, '.minerva'), { recursive: true });
  await fsp.writeFile(path.join(source, 'Start Here.md'), '---\ntags: [entrypoint]\n---\nhi', 'utf-8');
  await fsp.writeFile(path.join(source, '.minerva', 'config.json'), '{}', 'utf-8');
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe('installTutorialThoughtbase (#1542)', () => {
  it('copies the tree recursively into the destination', async () => {
    const dest = path.join(workdir, 'Minerva Tutorial');
    const finalDest = await installTutorialThoughtbase(dest, source);

    expect(finalDest).toBe(dest);
    expect(fs.readFileSync(path.join(finalDest, 'Start Here.md'), 'utf-8')).toContain('entrypoint');
    expect(fs.existsSync(path.join(finalDest, '.minerva', 'config.json'))).toBe(true);
  });

  it('never clobbers an existing dir — suffixes on collision', async () => {
    const dest = path.join(workdir, 'Minerva Tutorial');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'user-note.md'), 'do not delete me', 'utf-8');

    const finalDest = await installTutorialThoughtbase(dest, source);

    expect(finalDest).toBe(path.join(workdir, 'Minerva Tutorial 2'));
    // The pre-existing dir and its file are untouched.
    expect(fs.readFileSync(path.join(dest, 'user-note.md'), 'utf-8')).toBe('do not delete me');
    expect(fs.existsSync(path.join(finalDest, 'Start Here.md'))).toBe(true);
  });

  it('keeps suffixing past the first collision (3, then 4, …)', async () => {
    const base = path.join(workdir, 'Minerva Tutorial');
    fs.mkdirSync(base);
    fs.mkdirSync(`${base} 2`);
    expect(firstAvailableDir(base)).toBe(`${base} 3`);
  });

  it('throws when the bundled tree is missing (broken build)', async () => {
    await expect(
      installTutorialThoughtbase(path.join(workdir, 'dest'), path.join(workdir, 'nonexistent')),
    ).rejects.toThrow(/bundled thoughtbase not found/);
  });
});
