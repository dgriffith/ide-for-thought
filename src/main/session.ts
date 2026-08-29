import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { loadConfigFileSync } from './config/config-store';

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  rootPath: string;
}

// Resolved per call (thunk), not at module load — a module-level constant here
// would call `app.getPath` the moment this file is imported, which throws
// outside a ready Electron app (unit tests reaching this transitively).
function filePath(): string {
  return path.join(app.getPath('userData'), 'session.json');
}

function isWindowState(v: unknown): v is WindowState {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.x === 'number' && typeof o.y === 'number'
    && typeof o.width === 'number' && typeof o.height === 'number'
    && typeof o.rootPath === 'string';
}

export function loadSession(): WindowState[] {
  return loadConfigFileSync<WindowState[]>(
    filePath,
    (raw) => (Array.isArray(raw) ? raw.filter(isWindowState) : []),
    [],
  );
}

export function saveSession(windows: WindowState[]): void {
  fs.writeFileSync(filePath(), JSON.stringify(windows), 'utf-8');
}
