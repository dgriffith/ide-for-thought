/**
 * Persistence for the per-machine skill menu config (#630).
 *
 * Stored as `~/.minerva/menu-config.json`. Loaded once at startup into a module
 * cache so the (synchronous) menu builder and registry sync can read it without
 * awaiting; mutations go through `saveMenuConfig`, which rewrites the file and
 * refreshes the cache. `file` is injectable for tests.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type MenuConfig,
  emptyMenuConfig,
  normalizeMenuConfig,
} from '../../shared/skills/menu-config';

export function menuConfigPath(): string {
  return path.join(os.homedir(), '.minerva', 'menu-config.json');
}

let cached: MenuConfig = emptyMenuConfig();

/** Synchronous accessor for the last-loaded config (menu.ts / register.ts). */
export function getMenuConfig(): MenuConfig {
  return cached;
}

/** Read and cache the config. Missing file → empty (the all-defaults case). */
export async function loadMenuConfig(file: string = menuConfigPath()): Promise<MenuConfig> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    cached = normalizeMenuConfig(JSON.parse(raw));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      cached = emptyMenuConfig();
    } else {
      // Corrupt JSON or unreadable file: fall back to defaults rather than
      // crashing startup. The user can re-save from Settings to repair it.
      console.warn('[skills] failed to read menu-config.json; using defaults:', e);
      cached = emptyMenuConfig();
    }
  }
  return cached;
}

/** Validate, persist, and cache a new config. */
export async function saveMenuConfig(
  config: MenuConfig,
  file: string = menuConfigPath(),
): Promise<MenuConfig> {
  const normalized = normalizeMenuConfig(config);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(normalized, null, 2) + '\n', 'utf-8');
  cached = normalized;
  return normalized;
}
