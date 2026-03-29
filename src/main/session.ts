import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  rootPath: string;
}

const filePath = path.join(app.getPath('userData'), 'session.json');

export function loadSession(): WindowState[] {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function saveSession(windows: WindowState[]): void {
  fs.writeFileSync(filePath, JSON.stringify(windows), 'utf-8');
}
