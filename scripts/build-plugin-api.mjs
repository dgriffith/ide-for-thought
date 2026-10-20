#!/usr/bin/env node
/**
 * Regenerate the plugin API package in `plugin-api/` from
 * `src/shared/plugins/api.ts` (#2826): `index.js`, `index.d.ts`, `abi.json`.
 *
 *   node scripts/build-plugin-api.mjs          # regenerate
 *   node scripts/build-plugin-api.mjs --check  # exit 1 if the committed files are stale
 *
 * Refuses to write when the change breaks main's ABI snapshot without a major
 * bump of PLUGIN_API_VERSION, or adds to it without a minor one. Bump the
 * version in api.ts and run it again; there is no override.
 * `tests/architecture/plugin-api-abi.test.ts` holds the same rules offline.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abiOf, checkApi, generateAbiJson, generateDts, generateJs, readApiSource, versionProblems } from './lib/plugin-api-gen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'src', 'shared', 'plugins', 'api.ts');
const OUT = path.join(ROOT, 'plugin-api');

const api = readApiSource(fs.readFileSync(SOURCE, 'utf8'), SOURCE);
const problems = checkApi(api);
if (problems.length > 0) {
  console.error(`✗ src/shared/plugins/api.ts:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

const files = { 'index.js': generateJs(api), 'index.d.ts': generateDts(api), 'abi.json': generateAbiJson(api) };

if (process.argv.includes('--check')) {
  const stale = Object.entries(files).filter(([name, text]) => {
    const file = path.join(OUT, name);
    return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text;
  }).map(([name]) => name);
  if (stale.length > 0) {
    console.error(`✗ plugin-api/ is stale (${stale.join(', ')}): run node scripts/build-plugin-api.mjs`);
    process.exit(1);
  }
  console.log('✓ plugin-api/ matches src/shared/plugins/api.ts');
  process.exit(0);
}

/**
 * The snapshot this branch is changing: `main`'s, at the merge base — not the
 * working tree's, so regenerating twice on one branch doesn't ask for a
 * second bump. Falls back to the file on disk when git can't say.
 */
function baselineAbi() {
  const abiFile = path.join(OUT, 'abi.json');
  try {
    const opts = { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], opts).trim();
    return JSON.parse(execFileSync('git', ['show', `${base}:plugin-api/abi.json`], opts));
  } catch {
    return fs.existsSync(abiFile) ? JSON.parse(fs.readFileSync(abiFile, 'utf8')) : null;
  }
}

const baseline = baselineAbi();
if (baseline) {
  const rule = versionProblems(baseline, abiOf(api));
  if (rule.length > 0) {
    console.error(`✗ ${rule.join('\n')}`);
    process.exit(1);
  }
}
fs.mkdirSync(OUT, { recursive: true });
for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), text);
console.log(`✓ plugin-api/ regenerated for plugin API ${api.version}`);
