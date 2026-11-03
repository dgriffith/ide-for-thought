#!/usr/bin/env node
/**
 * Build every built-in plugin's view (#2828) and logic (#2643): each folder in
 * `plugins/` with an `index.html` or a `src/logic.ts`, through
 * `vite.core-plugins.config.mts`, into
 * `node_modules/.cache/minerva/core-plugins/<id>/`. `--watch` rebuilds on change (for `pnpm dev`).
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const ids = fs.readdirSync(path.join(ROOT, 'plugins'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && ['index.html', 'src/logic.ts'].some((f) => fs.existsSync(path.join(ROOT, 'plugins', e.name, f))))
  .map((e) => e.name)
  .sort();

// On Windows the bin is `vite.cmd`, which Node only spawns through a shell
// (CVE-2024-27980). The arguments are fixed literals (#2180).
const win = process.platform === 'win32';
const vite = path.join(ROOT, 'node_modules', '.bin', win ? 'vite.cmd' : 'vite');
for (const id of ids) {
  const args = ['build', '--config', 'vite.core-plugins.config.mts', '--logLevel', 'warn', ...(watch ? ['--watch'] : [])];
  const env = { ...process.env, CORE_PLUGIN: id };
  if (watch) spawn(vite, args, { cwd: ROOT, env, stdio: 'inherit', shell: win });
  else {
    execFileSync(vite, args, { cwd: ROOT, env, stdio: 'inherit', shell: win });
    console.log(`✓ built-in plugin view: ${id}`);
  }
}
