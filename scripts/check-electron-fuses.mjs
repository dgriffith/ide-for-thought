#!/usr/bin/env node
/**
 * Read the fuses back off a BUILT Minerva.app and compare them to the policy
 * (#2366).
 *
 * `forge.config.ts` asks for the fuses, and the architecture test pins what it
 * asks for — but neither proves the bits in the shipped binary. A plugin that
 * silently no-ops (an @electron/fuses that doesn't know a newer wire, a
 * packaging path that skips the hook) would pass both. This reads the binary.
 *
 *   node scripts/check-electron-fuses.mjs [path/to/Minerva.app]
 *
 * Defaults to the forge output for this platform/arch. Run by ci.yml's e2e job
 * after `pnpm test:e2e` has packaged the app, and by release.yml against the
 * signed build before it is smoke-booted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCurrentFuseWire } from '@electron/fuses';
import { checkFuseWire } from './lib/electron-fuses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const app = process.argv[2]
    ?? path.join(ROOT, 'out', `Minerva-${process.platform}-${process.arch}`, 'Minerva.app');
  if (!fs.existsSync(app)) {
    console.error(`::error::no packaged app at ${app} — build it first (pnpm build:e2e / pnpm build)`);
    process.exit(1);
  }

  const wire = await getCurrentFuseWire(app);
  const result = checkFuseWire(wire);

  console.log(`Electron fuses in ${path.relative(ROOT, app) || app}:`);
  for (const line of result.lines) console.log(`  ${line}`);

  if (!result.ok) {
    // `::error::` lands on the job summary, not just in the log.
    for (const e of result.errors) console.error(`::error::${e}`);
    process.exit(1);
  }
  console.log('✓ fuse wire matches scripts/lib/electron-fuses.mjs');
}

await main();
