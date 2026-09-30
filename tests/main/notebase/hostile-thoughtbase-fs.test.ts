/**
 * The sandboxed notebase file API against an adversarial thoughtbase (#2372).
 *
 * `listFiles` is the sidebar tree. It used to `readdir` every folder with no
 * guard, so ONE permission-denied subfolder rejected the whole listing and
 * the thoughtbase opened with no files at all. `readFile` is what the editor
 * and the LLM's `read_note` use; the symlink cases are #2357's guard (H2),
 * re-checked against the shared hostile tree rather than a one-off fixture.
 */
import { describe, it, expect } from 'vitest';
import { silenceLogTags } from '../../helpers/quiet-logs';
import fs from 'node:fs';
import path from 'node:path';
import { listFiles, readFile } from '../../../src/main/notebase/fs';
import type { NoteFile } from '../../../src/shared/types';
import {
  useHostileThoughtbase,
  ALL_HOSTILE_FEATURES,
  CONTROL_NOTES,
  OUTSIDE_SECRET,
} from '../../helpers/hostile-thoughtbase';

function flatten(files: NoteFile[]): NoteFile[] {
  return files.flatMap((f) => [f, ...(f.children ? flatten(f.children) : [])]);
}

// Expected: these tests drive failure paths the code logs (#2390).
silenceLogTags('thoughtbase');

describe('notebase listFiles on a hostile thoughtbase (#2372)', () => {
  const tb = useHostileThoughtbase(ALL_HOSTILE_FEATURES, 'minerva-fs-hostile-');

  it('lists the tree instead of rejecting over a permission-denied folder', async () => {
    const all = flatten(await listFiles(tb.manifest.root)).map((f) => f.relativePath);
    expect(all).toEqual(expect.arrayContaining([CONTROL_NOTES.alpha, CONTROL_NOTES.beta]));
  });

  it('shows the permission-denied folder itself, with no children', async () => {
    const locked = tb.manifest.paths['unreadable-dir']?.[0];
    if (!locked) return; // running as root: nothing was locked
    const entry = flatten(await listFiles(tb.manifest.root)).find((f) => f.relativePath === locked);
    expect(entry).toMatchObject({ isDirectory: true, children: [] });
  });

  it('lists the unreadable note, the dangling link and the long-path note as files', async () => {
    const all = new Set(flatten(await listFiles(tb.manifest.root)).map((f) => f.relativePath));
    const expected = [
      ...(tb.manifest.paths['unreadable-note'] ?? []),
      ...(tb.manifest.paths['symlink-dangling'] ?? []),
      ...(tb.manifest.paths['long-path'] ?? []),
      ...(tb.manifest.paths['long-filename'] ?? []),
    ];
    expect(expected.filter((p) => !all.has(p))).toEqual([]);
  });

  it('never lists what is behind a directory link that leaves the root', async () => {
    const all = flatten(await listFiles(tb.manifest.root)).map((f) => f.relativePath);
    expect(all.filter((p) => p.startsWith(path.join('links', 'escape-dir') + path.sep))).toEqual([]);
  });

  it('still throws when the thoughtbase root itself cannot be listed', async () => {
    if (!tb.manifest.fs.permissionsEnforced) return;
    fs.chmodSync(tb.manifest.root, 0o000);
    try {
      await expect(listFiles(tb.manifest.root)).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      fs.chmodSync(tb.manifest.root, 0o755);
    }
  });
});

describe('notebase readFile on a hostile thoughtbase (#2357, #2372)', () => {
  const tb = useHostileThoughtbase(ALL_HOSTILE_FEATURES, 'minerva-fs-read-hostile-');

  it('refuses a file link that leaves the root', async () => {
    const rel = tb.manifest.paths['symlink-file-outside']![0];
    await expect(readFile(tb.manifest.root, rel)).rejects.toThrow();
  });

  it('refuses a path through a directory link that leaves the root', async () => {
    const rel = path.join(tb.manifest.paths['symlink-dir-outside']![0], 'inner.md');
    await expect(readFile(tb.manifest.root, rel)).rejects.toThrow();
  });

  it('reads an in-root link as its target', async () => {
    const rel = tb.manifest.paths['symlink-in-root']![0];
    expect(await readFile(tb.manifest.root, rel)).toContain('inrootmarker');
  });

  it('decodes invalid UTF-8 with replacement characters and keeps the rest', async () => {
    const text = await readFile(tb.manifest.root, tb.manifest.paths['invalid-utf8']![0]);
    expect(text).toContain('�');
    expect(text).toContain('tail');
  });

  it('reads a note whose canonical path is near PATH_MAX', async () => {
    const rel = tb.manifest.paths['long-path']?.[0];
    if (!rel) return; // no known PATH_MAX on this platform
    expect(await readFile(tb.manifest.root, rel)).toContain('longpathmarker');
  });

  it('never returns the outside secret for any path the fixture created', async () => {
    const rels = Object.values(tb.manifest.paths).flat();
    for (const rel of rels) {
      const text = await readFile(tb.manifest.root, rel).catch(() => '');
      expect(text).not.toContain(OUTSIDE_SECRET);
    }
  });
});
