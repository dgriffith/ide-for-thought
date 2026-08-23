/**
 * @vitest-environment node
 *
 * Ratchets on known-bad patterns (#1848, epic #1855).
 *
 * CLAUDE.md documents anti-patterns and carries a "Migration backlog" of the
 * places that still have them. Prose doesn't fail a build, and it shows: the
 * backlog moved by one item in three weeks while brand-new code (#1835)
 * introduced two fresh instances of the very shapes it names.
 *
 * These are budgets, not verdicts. A number checked in that may go DOWN and
 * may not go UP. Nothing here claims every listed site is wrong — several are
 * deliberate and correct. The claim is narrower and more useful: whatever the
 * count is today, adding to it should be a decision someone makes on purpose,
 * in a diff, rather than a thing that happens.
 *
 * Same shape as the coverage floors in `vitest.config.mts`, and it works for
 * the same reason: it turns "we should get around to that" into a line in a
 * diff.
 *
 * ── On lexical scanning ─────────────────────────────────────────────────────
 * These match source text, not a parsed AST. That's a deliberate trade — a
 * ratchet has to be cheap enough to run in the normal suite and simple enough
 * that its failure message points at something real. The cost is known blind
 * spots, stated here rather than discovered later:
 *
 *   - a catch block that does anything before returning empty (a `console.warn`
 *     first, say) is NOT counted;
 *   - a swallow written across an intermediate variable is not counted;
 *   - comments and strings containing the pattern would count (none do today).
 *
 * So these undercount. They cannot be gamed into passing by *reformatting*,
 * only by writing the anti-pattern in a shape the regex misses — at which
 * point you've had to work around a test that told you not to.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

/** Occurrences per repo-relative file, omitting files with none. */
function countPerFile(dir: string, pattern: RegExp): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of tsFilesUnder(dir)) {
    const matches = fs.readFileSync(file, 'utf-8').match(pattern);
    if (matches?.length) counts[path.relative(ROOT, file)] = matches.length;
  }
  return counts;
}

/**
 * Compare a measured population against its committed baseline and fail with
 * an instruction, not a diff dump. Which direction it moved changes what the
 * author should do, so the message says which.
 */
function assertRatchet(
  label: string,
  baseline: Record<string, number>,
  actual: Record<string, number>,
  guidance: string,
): void {
  const files = [...new Set([...Object.keys(baseline), ...Object.keys(actual)])].sort();
  const added: string[] = [];
  const removed: string[] = [];
  for (const file of files) {
    const before = baseline[file] ?? 0;
    const now = actual[file] ?? 0;
    if (now > before) added.push(`  + ${file}: ${before} → ${now}`);
    if (now < before) removed.push(`  − ${file}: ${before} → ${now}`);
  }

  if (added.length > 0) {
    expect.fail(
      `${label}: the count went UP.\n\n${added.join('\n')}\n\n${guidance}\n\n` +
      'If this really is the right call, update the baseline in this file and say why in the PR.',
    );
  }
  if (removed.length > 0) {
    expect.fail(
      `${label}: the count went DOWN — nice.\n\n${removed.join('\n')}\n\n` +
      'Lower the baseline in this file so the ratchet holds the new ground.',
    );
  }
}

// ── Ratchet 1: swallowed errors ─────────────────────────────────────────────

/**
 * A catch block whose entire body is `return <empty value>` — the "swallowing"
 * anti-pattern CLAUDE.md names: it discards a real error and reports the
 * result as an ordinary empty answer, so a corrupt file reads as "not written
 * yet" and a permissions error reads as "nothing found".
 *
 * The convention is to catch a SPECIFIC expected condition (ENOENT → sentinel)
 * and let everything else throw — see `readJsonFileOr` in `ipc/read-json.ts`
 * for the shape.
 */
const SWALLOW = /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?:\[\]|null|undefined|''|""|\{\}|false|0)\s*;?\s*\}/g;

/**
 * Baseline as of #1848. Not an approval list — several of these are correct
 * (a JSON.stringify fallback, an ENOENT probe). It is the line we don't cross.
 *
 * When you touch one of these files, it is worth asking whether its catch is
 * hiding something. `history/store.ts` is not on this list any more because
 * that question got asked (#1835).
 */
const SWALLOW_BASELINE: Record<string, number> = {
  'src/main/clipper/clipper-ingest.ts': 1,
  'src/main/compute/audit.ts': 1,
  'src/main/compute/consent.ts': 1,
  'src/main/compute/proposal-helpers.ts': 1,
  'src/main/compute/save-cell-output.ts': 1,
  'src/main/config/config-store.ts': 1,
  'src/main/embeddings/backfill.ts': 1,
  'src/main/git/github-repo.ts': 2,
  'src/main/git/index.ts': 1,
  'src/main/git/publish-git.ts': 1,
  'src/main/graph/index.ts': 1,
  'src/main/graph/indexers/excerpt.ts': 1,
  'src/main/graph/indexers/source.ts': 1,
  'src/main/graph/parser.ts': 1,
  'src/main/images/remote-image-cache.ts': 2,
  'src/main/llm/conversation.ts': 2,
  'src/main/llm/provider/openai.ts': 1,
  'src/main/llm/settings.ts': 1,
  'src/main/llm/thoughtbase-doc.ts': 1,
  'src/main/main.ts': 1,
  'src/main/notebase/fs.ts': 1,
  'src/main/notebase/templates.ts': 1,
  'src/main/privileged-sites.ts': 1,
  'src/main/project-config.ts': 1,
  'src/main/publish/csl/user-assets.ts': 2,
  'src/main/publish/exporters/static-site/search-script.ts': 1,
  'src/main/publish/pipeline.ts': 2,
  'src/main/recent-projects.ts': 1,
  'src/main/saved-queries.ts': 1,
  'src/main/saved-views.ts': 1,
  'src/main/search/minisearch-provider.ts': 1,
  'src/main/secret-storage.ts': 1,
  'src/main/session.ts': 1,
  'src/main/sources/create-reference-stubs.ts': 1,
  'src/main/sources/csv-schema.ts': 3,
  'src/main/sources/import-zotero-rdf.ts': 1,
  'src/main/sources/source-id.ts': 1,
  'src/main/sources/tables.ts': 1,
};

// ── Ratchet 2: no-project answered with null ────────────────────────────────

/**
 * `withRootPathOr(null, …)` — the handler answers `null` when no project is
 * open, and its domain call answers `null` for "not found", so the caller
 * cannot tell the two apart. CLAUDE.md rule 5: a sentinel marks exactly ONE
 * expected absence. Rule 2: a `withRootPathOr` fallback must mean the same
 * thing as a genuinely-empty result, never "error".
 *
 * #1841 cleared four of these. The one that remains is the interesting kind of
 * survivor: for a completion schema, "no project" and "nothing to complete
 * against" arguably ARE the same answer. That's a judgement worth making
 * deliberately, which is what this ratchet forces.
 */
const NO_PROJECT_NULL = /withRootPathOr\s*(?:<[^>]*>)?\s*\(\s*null\b/g;

const NO_PROJECT_NULL_BASELINE: Record<string, number> = {
  'src/main/ipc/register-graph.ts': 1,
};

describe('known-bad pattern ratchets (#1848)', () => {
  it('the scanners still find things — a broken regex would pass vacuously', () => {
    // The failure mode that would quietly turn both ratchets into decoration.
    expect(Object.keys(countPerFile('src/main', SWALLOW)).length).toBeGreaterThan(20);
    expect(Object.keys(countPerFile('src/main', NO_PROJECT_NULL)).length).toBeGreaterThan(0);
  });

  it('swallowed errors: no new ones', () => {
    assertRatchet(
      'Swallowed errors (catch → empty value)',
      SWALLOW_BASELINE,
      countPerFile('src/main', SWALLOW),
      'A blanket catch that returns an empty value turns a corrupt file into "not written yet" ' +
      'and a permissions error into "nothing found". Catch the SPECIFIC expected condition ' +
      '(ENOENT → sentinel) and let the rest throw — see `readJsonFileOr` in `ipc/read-json.ts`, ' +
      'and CLAUDE.md → IPC error handling.',
    );
  });

  it('no-project answered with null: no new ones', () => {
    assertRatchet(
      'no-project → null (withRootPathOr(null, …))',
      NO_PROJECT_NULL_BASELINE,
      countPerFile('src/main', NO_PROJECT_NULL),
      'Use `withRootPath` so "no project open" throws, leaving `null` to mean only "not found" ' +
      '(CLAUDE.md rules 2 and 5). `withRootPathOr` is for handlers whose project-less answer is a ' +
      'legitimate value — an empty list a UI renders as "nothing yet" — not a way to signal failure.',
    );
  });
});
