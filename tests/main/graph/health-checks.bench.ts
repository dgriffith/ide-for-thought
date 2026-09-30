/**
 * `runAllChecks` benchmark (#2211, reproducing the perf review's C1). Not run
 * by `pnpm test` — invoke with `pnpm bench`.
 *
 * The gap this fills: the inspections sweep runs debounced off every graph
 * write, and nothing measured it. It fires ~17 whole-graph SPARQL queries plus
 * a full-corpus disk scan (`findOrphanedInlineAssets`) and an O(n log n) sort,
 * all on the main thread, after a save the user is still typing into.
 *
 * Measured at three vault scales, because the question C1 asks is not "is this
 * slow" but "how does it grow" — a per-save cost that scales with corpus size
 * is a different problem from one that doesn't.
 *
 * Runs with the default settings (every check enabled), which is what a user
 * who has never opened the inspections settings has.
 *
 * ── The fixture has to be STALE, or the biggest check never runs (#2208) ───
 *
 * This file used to write `# Note ${i}` with no frontmatter, so every note's
 * `dc:modified` was the mtime of a file written milliseconds earlier and
 * NOTHING passed the 30-day staleness filter. `checkStaleness` returned on its
 * first query every time. That is the single most expensive check in the sweep
 * — measured at 978ms of a 1,790ms total on a 3,000-note corpus where notes
 * really are old — so the bench that exists to watch this sweep was watching
 * it with its most expensive part switched off, and the same was true of the
 * `stub_aged` and `source_cited_unread` paths, which need sources the fixture
 * had none of.
 *
 * A perf fixture has to be able to REACH the code it is defending. Notes now
 * carry a backdated frontmatter `modified`, and a small source library hangs
 * off them, so the sweep here does the work a mature thoughtbase makes it do.
 * (#2331 re-blessed and armed the baseline entries on this fixture.)
 *
 * ── …and the sweep has to be the one production runs (#2383) ──────────────
 *
 * Every production caller passes `findOrphanedAssets` (project-context.ts, the
 * INSPECTIONS_RUN handler); this bench didn't, so `unreferenced_image` — the
 * full-corpus scan the header above names, and the largest single item in the
 * post-save burst per #2330 — reported nothing and cost nothing. And even with
 * the dep, a thoughtbase with no inline assets returns before the walk. The
 * bench now wires the real scanner and seeds a few pasted images, some
 * referenced and some orphaned, so the walk + per-file memo check runs over
 * the whole corpus every iteration, as it does after a real save. Measured
 * locally (a loaded machine, so indicative only) the steady-state scan moved
 * the sweep by less than run-to-run noise at every scale — the memo makes it a
 * walk + stat per file — so the armed baseline entries stay armed; the next
 * CI re-bless picks up the difference.
 *
 * Setup runs the sweep once and asserts every check the fixture is built to
 * feed actually reports something (`EXPECTED_TYPES`). What it does NOT seed:
 * claims, so the four argument checks run their queries over zero claims. At
 * ~13ms combined on a 3,000-note corpus (#2330's table) they are not where the
 * cost is; seeding them is a separate decision, not a silent gap.
 *
 * Seeding runs as a top-level `await` per scale rather than in `beforeAll` —
 * see `n3-cold-rebuild.bench.ts`'s header for why.
 */

import { describe, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { findOrphanedInlineAssets } from '../../../src/main/notebase/asset-references';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';
import { assertFixtureReaches } from '../../helpers/bench-fixture';

const SCALES = [500, 2000, 5000];

/** What production passes (project-context.ts, register-graph.ts) — without
 *  it the unreferenced-image check has nothing to scan. */
const DEPS = { findOrphanedAssets: findOrphanedInlineAssets };

/** Pasted-image names in `uploadImage`'s `<sha-prefix>-<safe-stem>.<ext>` shape.
 *  The first REFERENCED are embedded in notes; the rest are orphans. */
const ASSETS = Array.from({ length: 8 }, (_, k) => `${(0xa1b2c3 + k).toString(16)}-pasted-image-${k}.png`);
const REFERENCED = 5;

/** Every check this fixture is built to feed. Each must report at least once. */
const EXPECTED_TYPES = [
  'stale_note',              // backdated `modified`
  'source_missing_metadata', // every fifth source lacks a title
  'source_duplicate_doi',    // DOIs repeat (see doiModulus)
  'source_cited_unread',     // notes cite sources nobody has read
  'unreferenced_image',      // three orphaned pasted images
];

for (const scale of SCALES) {
  const root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-healthchecks-')));
  const ctx: ProjectContext = projectContext(root);
  await initGraph(ctx);
  const DAY = 86_400_000;
  for (let i = 0; i < scale; i++) {
    // Spread over the last ~2 years, all comfortably past the 30-day default,
    // so `checkStaleness` has the whole corpus to choose its oldest 20 from.
    const modified = new Date(Date.now() - (60 + (i % 700)) * DAY).toISOString();
    fs.writeFileSync(
      path.join(root, `note-${i}.md`),
      `---\ntitle: Note ${i}\nmodified: ${modified}\n---\n\n`
      + `# Note ${i}\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-${i % 10}\n\n`
      + `[[note-${(i + 1) % scale}]] and [[cite::src-${i % 40}]]\n`
      + (i < REFERENCED ? `\n![figure](.minerva/assets/inline/${ASSETS[i]})\n` : ''),
    );
  }
  const assetDir = path.join(root, '.minerva', 'assets', 'inline');
  fs.mkdirSync(assetDir, { recursive: true });
  for (const name of ASSETS) fs.writeFileSync(path.join(assetDir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // A source library, so the five source checks and the citation join have
  // something to walk: a tenth of the notes' worth, some incomplete, some
  // stubs, some sharing a DOI.
  const sourceCount = Math.max(20, Math.floor(scale / 10));
  // DOIs repeat mod 50 — which at 500 notes is exactly the 50 sources, so NO
  // DOI was shared and the duplicate check had nothing to find (#2383's setup
  // assertion caught it). Capping the modulus at half the library keeps the
  // 2,000/5,000 fixtures byte-identical and gives the 500 one real duplicates.
  const doiModulus = Math.min(50, Math.floor(sourceCount / 2));
  for (let i = 0; i < sourceCount; i++) {
    const dir = path.join(root, '.minerva', 'sources', `src-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.ttl'),
      '@prefix minerva: <https://minerva.dev/ontology#> .\n'
      + '@prefix thought: <https://minerva.dev/ontology/thought#> .\n'
      + '@prefix dc: <http://purl.org/dc/terms/> .\n'
      + '@prefix bibo: <http://purl.org/ontology/bibo/> .\n'
      + `<https://minerva.dev/source/src-${i}> minerva:sourceId "src-${i}" ;\n`
      + (i % 5 === 0 ? '' : `  dc:title "Source ${i}" ;\n`)
      + (i % 3 === 0 ? '' : `  dc:creator "Author ${i}" ;\n`)
      + (i % 11 === 0 ? '  thought:stubStatus "unresolved" ;\n' : '')
      + `  bibo:doi "10.1234/abc${i % doiModulus}" ;\n`
      + `  bibo:uri <https://example.com/s${i % 60}> .\n`);
  }
  await indexAllNotes(ctx);

  // ── What this fixture must reach (#2383) ───────────────────────────────────
  // One sweep, and every check the fixture feeds has to have found something.
  // A check that errors is swallowed by `isolated()` into an empty result, so
  // "it ran" is only observable as "it reported" — which is exactly how #2330's
  // staleness gap stayed invisible.
  {
    const found = await runAllChecks(ctx, undefined, DEPS);
    const counts: Record<string, number> = {};
    for (const i of found) counts[i.type] = (counts[i.type] ?? 0) + 1;
    const missing = EXPECTED_TYPES.filter((t) => !counts[t]);
    assertFixtureReaches(`the sweep reports every check the fixture feeds: ${EXPECTED_TYPES.join(', ')}`, missing.length === 0, { missing, counts });
    const orphans = counts.unreferenced_image ?? 0;
    assertFixtureReaches(
      `the asset scan walks the corpus and finds exactly the ${ASSETS.length - REFERENCED} orphaned images`,
      orphans === ASSETS.length - REFERENCED,
      orphans,
    );
  }

  describe(`runAllChecks — ${scale}-note store`, () => {
    test(`runAllChecks at ${scale} notes`, async ({ bench }) => {
      await bench(`runAllChecks at ${scale} notes`, async () => {
        await runAllChecks(ctx, undefined, DEPS);
      }).run();
    });
  });
}
