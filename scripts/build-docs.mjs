/**
 * Generate the docs site (#1842).
 *
 * Writes `website/docs/*.html` from `_layout.html` + `_nav.json` +
 * `_content/*.html` (see `scripts/lib/docs-model.mjs` for the model). The
 * generated HTML stays committed — the site deploys straight from the repo via
 * `scripts/deploy-to-gh-pages.sh`, and there is no build step on gh-pages —
 * so this is a "regenerate and commit" step, not a dist target. Wired into
 * `predev`/`prebuild` ahead of the help-corpus build, which consumes the same
 * fragments.
 *
 * Adding a docs page is now two files: one `_content/<page>.html` fragment and
 * one entry in `_nav.json`. Every other page's sidebar and pager follows.
 *
 *   node scripts/build-docs.mjs           write changed pages
 *   node scripts/build-docs.mjs --check   exit 1 if anything would change
 *
 * `--check` is what CI/the test use; it never writes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocs } from './lib/docs-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT, 'website', 'docs');
const check = process.argv.includes('--check');

const pages = buildDocs(DOCS_DIR);

const changed = [];
for (const [name, html] of pages) {
  const file = path.join(DOCS_DIR, name);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
  if (existing === html) continue;
  changed.push(name);
  if (!check) fs.writeFileSync(file, html);
}

// A page whose fragment was deleted would otherwise linger as a stale file the
// generator no longer owns — and would still be picked up by the deploy.
const stale = fs.readdirSync(DOCS_DIR)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_') && !pages.has(f));

if (check) {
  if (!changed.length && !stale.length) {
    console.log(`docs are up to date — ${pages.size} pages match website/docs/`);
    process.exit(0);
  }
  if (changed.length) console.error(`docs are stale — ${changed.length} page(s) differ from the generator:\n  ${changed.join('\n  ')}`);
  if (stale.length) console.error(`orphaned page(s) in website/docs/ with no _content fragment:\n  ${stale.join('\n  ')}`);
  console.error('\nRun `pnpm build:docs` and commit the result.');
  process.exit(1);
}

if (stale.length) {
  console.warn(`warning: ${stale.length} page(s) in website/docs/ have no _content fragment and were left alone: ${stale.join(', ')}`);
}
console.log(changed.length
  ? `docs built: ${changed.length} of ${pages.size} page(s) rewritten in website/docs/`
  : `docs built: all ${pages.size} pages already up to date`);
