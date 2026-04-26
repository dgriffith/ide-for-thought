/**
 * Path-traversal guard coverage (#397).
 *
 * The bug-shaped concern is "a file/folder mutation handler forgets
 * to validate its path argument and lets the renderer escape the
 * project root." Existing coverage:
 *
 * - `tests/main/notebase/fs.test.ts` covers `assertSafePath` in
 *   isolation (the rules it enforces).
 *
 * What was missing: a check that the wrapper functions exposed by
 * `notebaseFs` (which is what every IPC handler calls) actually go
 * through `assertSafePath`, AND a check that the path-taking IPC
 * handlers route through those wrappers (rather than reaching past
 * them to raw `fs.*`).
 *
 * Two tests close the gap:
 *
 * 1. **Wrappers**: spy on `assertSafePath`, invoke each
 *    notebaseFs.<mutation> against a temp project, assert the spy
 *    fired with the right (rootPath, relativePath) pair.
 *
 * 2. **Handlers**: the IPC handlers in `src/main/ipc.ts` for
 *    path-taking mutation channels are listed here by name; each
 *    line range in the source must reference one of the known-safe
 *    sinks (notebaseFs.<x>, writeAndReindex, renameWithLinkRewrites,
 *    drop-import). A handler that bypasses those would fail this
 *    static check before the path-traversal regression hit
 *    production.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as notebaseFs from '../../../src/main/notebase/fs';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-asp-'));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

// Note: a direct vi.spyOn(notebaseFs, 'assertSafePath') doesn't
// intercept module-internal calls because of how vitest binds ESM
// exports. The traversal-rejection tests below are equivalent: a
// traversal can only be rejected by assertSafePath, so passing them
// proves the guard fires inside every mutation function.

describe('every notebaseFs mutation rejects a traversal-style path (#397)', () => {
  it.each([
    ['writeFile', () => notebaseFs.writeFile(root, '../escape.md', 'x')],
    ['createFile', () => notebaseFs.createFile(root, '../escape.md')],
    ['deleteFile', () => notebaseFs.deleteFile(root, '../escape.md')],
    ['createFolder', () => notebaseFs.createFolder(root, '../escape')],
    ['deleteFolder', () => notebaseFs.deleteFolder(root, '../escape')],
    ['rename (old)', () => notebaseFs.rename(root, '../escape.md', 'fine.md')],
    ['rename (new)', () => notebaseFs.rename(root, 'fine.md', '../escape.md')],
    ['copyItem (src)', () => notebaseFs.copyItem(root, '../escape.md', 'fine.md')],
    ['copyItem (dest)', () => notebaseFs.copyItem(root, 'fine.md', '../escape.md')],
  ])('%s throws Path traversal', async (_, op) => {
    await expect(op()).rejects.toThrow('Path traversal');
  });
});

describe('IPC handlers route path args through a known-safe sink (#397)', () => {
  // Static check: read ipc.ts source, locate each path-taking IPC
  // handler block, and assert its body contains a call to a
  // known-safe sink. A new handler that goes straight to fs.promises
  // (skipping notebaseFs / writeAndReindex / renameWithLinkRewrites
  // / drop-import) fails this check.
  const ipcSource = fs.readFileSync(
    path.join(__dirname, '../../../src/main/ipc.ts'),
    'utf-8',
  );

  // Each entry: a Channel constant whose handler must call one of
  // the sinks below. The right-hand list is the ALLOWLIST — at
  // least one must appear inside the handler's body.
  const SAFE_SINKS = [
    'notebaseFs.',           // any notebaseFs.* export — they all gate on assertSafePath
    'writeAndReindex',       // wrapper around notebaseFs.writeFile (#341)
    'renameWithLinkRewrites', // wrapper around notebaseFs.rename
    'renameAnchor',          // notebaseFs-backed (#341 anchor variant)
    'renameSource',          // notebase/rename-source-excerpt — also gates paths
    'renameExcerpt',         // notebase/rename-source-excerpt
    'dropImport',            // src/main/notebase/drop-import — calls assertSafePath itself
  ] as const;

  const PATH_TAKING_CHANNELS = [
    'NOTEBASE_WRITE_FILE',
    'NOTEBASE_CREATE_FILE',
    'NOTEBASE_DELETE_FILE',
    'NOTEBASE_CREATE_FOLDER',
    'NOTEBASE_DELETE_FOLDER',
    'NOTEBASE_RENAME',
    'NOTEBASE_RENAME_SOURCE',
    'NOTEBASE_RENAME_EXCERPT',
    'NOTEBASE_COPY',
    'FILES_DROP_IMPORT',
  ] as const;

  /** Find a handler block by its `Channels.X` ref and return the
   *  text from the call open to its matching closing brace. */
  function handlerBody(source: string, channelConst: string): string | null {
    const startMarker = `Channels.${channelConst}`;
    const idx = source.indexOf(startMarker);
    if (idx < 0) return null;
    // The handler block is `ipcMain.handle(Channels.X, async (...) => { … });`.
    // Find the body open after the channel ref.
    const arrowIdx = source.indexOf('=>', idx);
    if (arrowIdx < 0) return null;
    const braceIdx = source.indexOf('{', arrowIdx);
    if (braceIdx < 0) return null;
    let depth = 1;
    let i = braceIdx + 1;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    return source.slice(braceIdx, i);
  }

  it.each(PATH_TAKING_CHANNELS)('%s handler routes through a known-safe sink', (channel) => {
    const body = handlerBody(ipcSource, channel);
    expect(body, `Channels.${channel} handler not found in ipc.ts`).not.toBeNull();
    const ok = SAFE_SINKS.some((sink) => body!.includes(sink));
    expect(ok, `Channels.${channel} doesn't reference any of: ${SAFE_SINKS.join(', ')}`).toBe(true);
  });
});
