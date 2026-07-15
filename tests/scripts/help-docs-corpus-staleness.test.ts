/**
 * CI staleness gate for the help-docs corpus (#1288, epic:docs-grounding, #1154).
 *
 * `predev`/`prebuild`/`prebuild:e2e` already regenerate `resources/help-docs/
 * corpus.json` (#1284) on every dev start and every build, so staleness never
 * survives the normal dev/release loop. But CI's `lint-and-test` job runs
 * `pnpm coverage`, not `pnpm predev` — it never rebuilds the corpus, and that
 * file is gitignored (derived, not committed), so nothing catches "added or
 * edited a website/docs/*.html page and forgot the corpus reflects it" at PR
 * review time. It would only surface later, after the next real build.
 *
 * This runs just the extraction (not the embedding — no reason to burn CI
 * time re-embedding ~500 chunks) against the real website/docs/*.html and
 * snapshots the resulting chunk-id set. A docs edit that adds, removes, or
 * retitles a section changes the ids, which fails this snapshot — the diff in
 * the PR shows exactly what changed. Update intentionally with:
 *   pnpm test tests/scripts/help-docs-corpus-staleness.test.ts -u
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain JS build-time module, no .d.ts
import { extractDocsCorpus as extractDocsCorpusImpl } from '../../scripts/lib/extract-docs-corpus.mjs';

interface DocChunk {
  id: string;
}

const extractDocsCorpus = extractDocsCorpusImpl as (docsDir: string) => DocChunk[];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS_DIR = path.join(ROOT, 'website', 'docs');

describe('help-docs corpus staleness (#1288)', () => {
  it('chunk ids freshly extracted from website/docs/*.html match the reviewed snapshot', () => {
    const chunks = extractDocsCorpus(DOCS_DIR);
    expect(chunks.length).toBeGreaterThan(0);
    const ids = chunks.map((c) => c.id).sort();
    expect(ids).toMatchSnapshot();
  });
});
