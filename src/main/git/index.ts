import git from 'isomorphic-git';
import fs from 'node:fs';
import path from 'node:path';

export interface GitFileStatus {
  filepath: string;
  status: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  files: GitFileStatus[];
}

export async function getStatus(rootPath: string): Promise<GitStatus> {
  try {
    const branch = await git.currentBranch({ fs, dir: rootPath }) ?? null;
    const matrix = await git.statusMatrix({ fs, dir: rootPath });

    const files: GitFileStatus[] = matrix
      .filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))
      .map(([filepath, head, workdir, stage]) => ({
        filepath,
        status: statusLabel(head, workdir, stage),
      }));

    return { isRepo: true, branch, files };
  } catch {
    return { isRepo: false, branch: null, files: [] };
  }
}

function statusLabel(head: number, workdir: number, stage: number): string {
  if (head === 0 && workdir === 2 && stage === 0) return 'new';
  if (head === 0 && workdir === 2 && stage === 2) return 'added';
  if (head === 1 && workdir === 2 && stage === 1) return 'modified';
  if (head === 1 && workdir === 2 && stage === 2) return 'modified+staged';
  if (head === 1 && workdir === 0 && stage === 0) return 'deleted';
  if (head === 1 && workdir === 0 && stage === 1) return 'deleted';
  return 'unknown';
}

export async function initRepo(rootPath: string): Promise<void> {
  await git.init({ fs, dir: rootPath, defaultBranch: 'main' });
}

export async function commitAll(rootPath: string, message: string): Promise<string> {
  // Stage all changes
  const matrix = await git.statusMatrix({ fs, dir: rootPath });
  for (const [filepath, head, workdir] of matrix) {
    if (workdir === 0) {
      await git.remove({ fs, dir: rootPath, filepath });
    } else if (head !== workdir) {
      await git.add({ fs, dir: rootPath, filepath });
    }
  }

  const sha = await git.commit({
    fs,
    dir: rootPath,
    message,
    author: {
      name: 'Minerva',
      email: 'user@minerva.local',
    },
  });

  return sha;
}

export async function getLog(rootPath: string, depth: number = 20): Promise<Array<{
  sha: string;
  message: string;
  date: Date;
  author: string;
}>> {
  try {
    const commits = await git.log({ fs, dir: rootPath, depth });
    return commits.map((c) => ({
      sha: c.oid,
      message: c.commit.message,
      date: new Date(c.commit.author.timestamp * 1000),
      author: c.commit.author.name,
    }));
  } catch {
    return [];
  }
}
