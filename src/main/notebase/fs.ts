import { dialog } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { NoteFile, NotebaseMeta } from '../../shared/types';
import { INDEXABLE_EXTS } from './indexable-files';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.minerva', '.obsidian']);

export async function openNotebase(): Promise<NotebaseMeta | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Open Thoughtbase',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const rootPath = result.filePaths[0];
  return {
    rootPath,
    name: path.basename(rootPath),
  };
}

export async function listFiles(rootPath: string): Promise<NoteFile[]> {
  return readDirectory(rootPath, rootPath);
}

async function readDirectory(dirPath: string, rootPath: string): Promise<NoteFile[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: NoteFile[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      const children = await readDirectory(fullPath, rootPath);
      files.push({
        name: entry.name,
        relativePath,
        isDirectory: true,
        children,
      });
    } else if (INDEXABLE_EXTS.has(path.extname(entry.name))) {
      files.push({
        name: entry.name,
        relativePath,
        isDirectory: false,
      });
    }
  }

  files.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return files;
}

/**
 * Best-effort realpath: returns the canonicalised path when the prefix
 * exists, falling back to the input when it doesn't (so projects can
 * still be checked before they're created).
 */
function realPathSafe(p: string): string {
  try {
    return fsSync.realpathSync(p);
  } catch {
    return p;
  }
}

export function assertSafePath(rootPath: string, relativePath: string): string {
  // realpath the rootPath so a project rooted on a symlinked path —
  // notably macOS's /var → /private/var, which is where tmpdir() lives
  // (#352) — doesn't make a normal in-project relative path look like
  // a traversal. We resolve `relativePath` *against* the realpath'd
  // root (rather than realpath'ing each result) because the leaf or
  // any intermediate dir may not exist yet (write-to-create), and
  // resolve doesn't follow symlinks anyway, so this canonical-prefix
  // form is enough to make the startsWith check sound.
  const realRoot = realPathSafe(rootPath);
  const resolved = path.resolve(realRoot, relativePath);
  if (!resolved.startsWith(realRoot + path.sep) && resolved !== realRoot) {
    throw new Error('Path traversal detected');
  }
  // Return the realpath-anchored resolution: it's always usable by
  // fs.* and won't drift between symlink endpoints in subsequent ops.
  return resolved;
}

export async function readFile(rootPath: string, relativePath: string): Promise<string> {
  const fullPath = assertSafePath(rootPath, relativePath);
  return fs.readFile(fullPath, 'utf-8');
}

/**
 * Binary-safe read for images / pdfs / other non-text assets the
 * renderer needs to display inline (#244 image rendering, #243 image
 * cell outputs persisted as sidecar files). Returns the raw bytes;
 * the caller decides how to encode (base64 + data URL is typical).
 *
 * Same path-traversal guard as `readFile`: out-of-root reads throw.
 */
export async function readBinaryFile(rootPath: string, relativePath: string): Promise<Uint8Array> {
  const fullPath = assertSafePath(rootPath, relativePath);
  const buf = await fs.readFile(fullPath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Binary-safe write — pair to `readBinaryFile`. Used for image upload
 * via drag-and-drop / paste in the editor (#455). Same path-traversal
 * guard as `writeFile`; creates parent directories on demand.
 */
export async function writeBinaryFile(
  rootPath: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, bytes);
}

/**
 * True iff `relativePath` resolves to an existing file. Used by the
 * asset-upload path to skip rewriting an asset that's already on
 * disk under the same content-hashed name (#455).
 */
export async function fileExists(rootPath: string, relativePath: string): Promise<boolean> {
  const fullPath = assertSafePath(rootPath, relativePath);
  try {
    const stat = await fs.stat(fullPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function writeFile(rootPath: string, relativePath: string, content: string): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

export async function createFile(rootPath: string, relativePath: string): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, '', 'utf-8');
}

export async function deleteFile(rootPath: string, relativePath: string): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  await fs.unlink(fullPath);
}

export async function createFolder(rootPath: string, relativePath: string): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  await fs.mkdir(fullPath, { recursive: true });
}

export async function deleteFolder(rootPath: string, relativePath: string): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  await fs.rm(fullPath, { recursive: true });
}

export async function rename(rootPath: string, oldRelPath: string, newRelPath: string): Promise<void> {
  const oldFull = assertSafePath(rootPath, oldRelPath);
  const newFull = assertSafePath(rootPath, newRelPath);
  await fs.mkdir(path.dirname(newFull), { recursive: true });
  await fs.rename(oldFull, newFull);
}

export async function copyItem(rootPath: string, srcRelPath: string, destRelPath: string): Promise<void> {
  const srcFull = assertSafePath(rootPath, srcRelPath);
  const destFull = assertSafePath(rootPath, destRelPath);
  await fs.mkdir(path.dirname(destFull), { recursive: true });
  await fs.cp(srcFull, destFull, { recursive: true });
}
