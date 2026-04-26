import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const MAX_RECENT = 10;
const filePath = path.join(app.getPath('userData'), 'recent-projects.json');

export function getRecentProjects(): string[] {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as string[];
  } catch {
    return [];
  }
}

export function addRecentProject(projectPath: string): void {
  const recent = getRecentProjects().filter((p) => p !== projectPath);
  recent.unshift(projectPath);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  fs.writeFileSync(filePath, JSON.stringify(recent), 'utf-8');
}

export function clearRecentProjects(): void {
  fs.writeFileSync(filePath, '[]', 'utf-8');
}
