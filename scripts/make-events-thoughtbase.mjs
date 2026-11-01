#!/usr/bin/env node
/**
 * Write the Events sample thoughtbase (`scripts/lib/events-thoughtbase.mjs`)
 * into a new folder, for testing the Timeline and Calendar layouts by hand:
 *
 *   pnpm sample:events ~/Minerva/Events Sample
 *
 * Refuses a folder that already has files in it, unless `--force`, which
 * rewrites the sample's own files and leaves anything else alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { eventsThoughtbase } from './lib/events-thoughtbase.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const dir = args.find((a) => a !== '--force');
if (!dir) {
  console.error('Usage: pnpm sample:events <folder> [--force]');
  process.exit(1);
}
const root = path.resolve(dir);
if (!force && fs.existsSync(root) && fs.readdirSync(root).some((f) => !f.startsWith('.'))) {
  console.error(`${root} already has files in it. Pick an empty folder, or pass --force to rewrite the sample's files there.`);
  process.exit(1);
}
const files = eventsThoughtbase(new Date());
for (const [rel, content] of Object.entries(files)) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
console.log(`Wrote ${Object.keys(files).length} notes to ${root}. Open it in Minerva and start with "Start Here".`);
