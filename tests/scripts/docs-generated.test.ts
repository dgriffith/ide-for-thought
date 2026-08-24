/**
 * `website/docs/*.html` is generated, and the generated output is committed (#1842).
 *
 * Both halves of that sentence are load-bearing. The site deploys straight
 * from the repo (`scripts/deploy-to-gh-pages.sh` copies `website/` onto
 * gh-pages — there is no build step there), so the HTML has to be in git. But
 * committed generated files invite hand-edits, and a hand-edit to a generated
 * file is worse than no generator at all: it survives review, then vanishes
 * the next time anyone runs `pnpm build:docs`.
 *
 * So this asserts the committed HTML is exactly what `scripts/build-docs.mjs`
 * produces from `_layout.html` + `_nav.json` + `_content/*.html`. Editing a
 * page directly fails here; the fix is to edit the fragment (or the nav) and
 * run `pnpm build:docs`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain JS build-time module, no .d.ts
import { buildDocs as buildDocsImpl } from '../../scripts/lib/docs-model.mjs';

const buildDocs = buildDocsImpl as (docsDir: string) => Map<string, string>;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS_DIR = path.join(ROOT, 'website', 'docs');

describe('website/docs is generated (#1842)', () => {
  const pages = buildDocs(DOCS_DIR);

  it('generates every page listed in _nav.json', () => {
    expect(pages.size).toBeGreaterThan(100);
  });

  it('leaves no page in website/docs/ that the generator does not own', () => {
    // `_`-prefixed files are the generator's own inputs, not output pages.
    const onDisk = fs.readdirSync(DOCS_DIR)
      .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
      .sort();
    expect(onDisk).toEqual([...pages.keys()].sort());
  });

  it.each([...pages.keys()])('%s matches the generator byte for byte', (name) => {
    const committed = fs.readFileSync(path.join(DOCS_DIR, name), 'utf-8');
    expect(committed).toBe(pages.get(name));
  });
});
