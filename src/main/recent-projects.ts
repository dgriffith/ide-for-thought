import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { loadConfigFileSync, asStringArray } from './config/config-store';

const MAX_RECENT = 10;

/**
 * Resolved per call, not at module load. `app.getPath` is unavailable until
 * Electron is ready, so a module-level constant made merely IMPORTING this file
 * a side effect — which broke every test suite that reaches it transitively
 * (notebase/fs.ts → read-note.ts → …) with a bare `electron` mock.
 */
function recentsFilePath(): string {
  return path.join(app.getPath('userData'), 'recent-projects.json');
}

export function getRecentProjects(): string[] {
  return loadConfigFileSync<string[]>(recentsFilePath, (raw) => asStringArray(raw, []), []);
}

export function addRecentProject(projectPath: string): void {
  const recent = getRecentProjects().filter((p) => p !== projectPath);
  recent.unshift(projectPath);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  fs.writeFileSync(recentsFilePath(), JSON.stringify(recent), 'utf-8');
}

/**
 * Where a thoughtbase folder picker should start (#1560).
 *
 * People keep their thoughtbases together — a `~/Minerva`, `~/thoughtbases`, or
 * `~/notes` folder — so the PARENT of the last one they opened is a far better
 * guess than the OS default, which lands on Downloads or wherever some
 * unrelated save panel was last. No new setting: the recents list already
 * records every thoughtbase opened or created, so the answer is derivable, and
 * it retrains itself the moment the user starts keeping them somewhere else.
 *
 * Walks the list rather than taking the head blindly: a thoughtbase that's been
 * deleted or moved shouldn't cost the hint. Falls back to Documents — a
 * conventional home for a new folder, and specifically not Downloads.
 */
export function defaultThoughtbaseDir(): string {
  for (const projectPath of getRecentProjects()) {
    const parent = path.dirname(projectPath);
    // `path.dirname('/')` is '/' — a root with no parent tells us nothing.
    if (parent === projectPath) continue;
    try {
      if (fs.statSync(parent).isDirectory()) return parent;
    } catch { /* gone since it was last opened — try the next one */ }
  }
  try {
    return app.getPath('documents');
  } catch {
    return app.getPath('home');
  }
}

export function clearRecentProjects(): void {
  fs.writeFileSync(recentsFilePath(), '[]', 'utf-8');
}
