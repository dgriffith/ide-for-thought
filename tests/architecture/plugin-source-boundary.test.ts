/**
 * A built-in plugin reaches only what an installed one could (#2828).
 *
 * The views in `plugins/<id>/` run in a plugin frame, on the plugin API. Their
 * source may import its own folder, the API Minerva serves
 * (`/@minerva/plugin-api.js`), pure modules from `src/shared/` (bundled in —
 * `src/shared` is lint-enforced pure, #668), and npm packages. Never
 * `src/renderer/` or `src/main/`, never Node or Electron: a built-in plugin that
 * borrowed the app's stores would be a plugin in name only, and the parity it
 * exists to prove (docs/plugin-code.md) would be a fiction.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const PLUGINS = path.join(ROOT, 'plugins');
const SHARED = path.join(ROOT, 'src', 'shared');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
    return /\.(ts|svelte|js|mjs)$/.test(e.name) ? [full] : [];
  });
}

const IMPORT = /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Why `spec`, imported from `file` in plugin `id`, is out of bounds; null when it's fine. */
function refusal(file: string, id: string, spec: string): string | null {
  if (spec === '/@minerva/plugin-api.js') return null;
  if (spec.startsWith('node:') || spec === 'electron' || spec.startsWith('electron/')) return 'Node and Electron are not for plugin code';
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // an npm package
  if (spec.startsWith('/')) return 'only /@minerva/plugin-api.js may be imported by absolute path';
  const target = path.resolve(path.dirname(file), spec);
  if (target.startsWith(path.join(PLUGINS, id) + path.sep)) return null;
  if (target.startsWith(SHARED + path.sep)) return null;
  return `reaches ${path.relative(ROOT, target)} — only its own folder, the plugin API and src/shared/`;
}

const files = fs.existsSync(PLUGINS) ? walk(PLUGINS) : [];

describe('built-in plugin source reaches only what an installed plugin could (#2828)', () => {
  it('has plugin source to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports only its own folder, the plugin API, src/shared/ and npm packages', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const id = path.relative(PLUGINS, file).split(path.sep)[0]!;
      for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
        const spec = (m[1] ?? m[2])!;
        const why = refusal(file, id, spec);
        if (why) offenders.push(`${path.relative(ROOT, file)}: '${spec}' — ${why}`);
      }
    }
    expect(offenders, 'A built-in plugin may import only its own folder, /@minerva/plugin-api.js, src/shared/ and npm packages.').toEqual([]);
  });

  it('the rule refuses what it should', () => {
    const file = path.join(PLUGINS, 'kanban', 'src', 'x.ts');
    expect(refusal(file, 'kanban', '../../../src/renderer/lib/ipc/client')).toMatch(/reaches src\/renderer/);
    expect(refusal(file, 'kanban', '../../../src/main/plugins/broker')).toMatch(/reaches src\/main/);
    expect(refusal(file, 'kanban', '../../other/src/y')).toMatch(/reaches plugins\/other/);
    expect(refusal(file, 'kanban', 'node:fs')).toMatch(/Node/);
    expect(refusal(file, 'kanban', 'electron')).toMatch(/Electron/);
    expect(refusal(file, 'kanban', '/assets/x.js')).toMatch(/absolute path/);
    expect(refusal(file, 'kanban', './Board.svelte')).toBeNull();
    expect(refusal(file, 'kanban', '../../../src/shared/objects/kanban')).toBeNull();
    expect(refusal(file, 'kanban', 'svelte')).toBeNull();
    expect(refusal(file, 'kanban', '/@minerva/plugin-api.js')).toBeNull();
  });
});
