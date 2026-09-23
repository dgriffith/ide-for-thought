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
 * The committed baseline entries predate this and measure the old fixture;
 * they are `gate: false`, so nothing fails on the difference — but they need a
 * CI re-bless before gating can be turned on for them.
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
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';

const SCALES = [500, 2000, 5000];

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
      + `[[note-${(i + 1) % scale}]] and [[cite::src-${i % 40}]]\n`,
    );
  }
  // A source library, so the five source checks and the citation join have
  // something to walk: a tenth of the notes' worth, some incomplete, some
  // stubs, some sharing a DOI.
  const sourceCount = Math.max(20, Math.floor(scale / 10));
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
      + `  bibo:doi "10.1234/abc${i % 50}" ;\n`
      + `  bibo:uri <https://example.com/s${i % 60}> .\n`);
  }
  await indexAllNotes(ctx);

  describe(`runAllChecks — ${scale}-note store`, () => {
    test(`runAllChecks at ${scale} notes`, async ({ bench }) => {
      await bench(`runAllChecks at ${scale} notes`, async () => {
        await runAllChecks(ctx);
      }).run();
    });
  });
}
