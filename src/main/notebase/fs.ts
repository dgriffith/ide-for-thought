import { dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NoteFile, NotebaseMeta } from '../../shared/types';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.minerva', '.obsidian']);

export async function openNotebase(): Promise<NotebaseMeta | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Open Notebase',
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
    if (entry.name.startsWith('.') && IGNORED_DIRS.has(entry.name)) continue;
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
    } else if (entry.name.endsWith('.md')) {
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

function assertSafePath(rootPath: string, relativePath: string): string {
  const resolved = path.resolve(rootPath, relativePath);
  if (!resolved.startsWith(rootPath + path.sep) && resolved !== rootPath) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

export async function readFile(rootPath: string, relativePath: string): Promise<string> {
  const fullPath = assertSafePath(rootPath, relativePath);
  return fs.readFile(fullPath, 'utf-8');
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
