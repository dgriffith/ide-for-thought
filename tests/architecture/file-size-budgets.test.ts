/**
 * @vitest-environment node
 *
 * Ratcheted file-size budgets (#1854, epic #1855).
 *
 * Every large module in this codebase got large the same way: gradually, with
 * each addition individually reasonable. `graph/queries.ts` reached ~1,200
 * lines exactly as `indexers.ts` and the old `ipc.ts` did before it — nobody
 * ever added 600 lines, everyone added 30.
 *
 * This is deliberately NOT a blanket "no file over N lines" rule. That rule
 * produces artificial splits and a wave of `eslint-disable`, and it would fail
 * on 28 files today for no actionable reason. The point is the derivative, not
 * the absolute: a 1,178-line file that stays 1,178 lines is not today's
 * problem; one that reaches 1,300 is, and the moment to notice is the PR that
 * does it rather than the next architecture review.
 *
 * A budget is not a verdict on the file. Several of these are long because
 * they are honest catalogs — `shared/channels.ts` is a list of channel names,
 * and splitting it would make it worse. The claim is only that growing one
 * should be a line in a diff.
 *
 * ── When this fails ─────────────────────────────────────────────────────────
 * Two options, and picking between them is the entire value of the check:
 *
 *   1. Extract a seam. If the addition doesn't belong in the same file as the
 *      rest, this is the moment that's easiest to see.
 *   2. Raise the number in the same PR. Sometimes the file really is the right
 *      home and the seam doesn't exist yet. Saying so in the diff is fine —
 *      the check is asking the question, not forbidding the answer.
 *
 * Also noted in CLAUDE.md → Conventions → File-size budgets.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Only files above this earn a budget. Below it, size is nobody's business —
 * a 400-line file growing to 450 is just a file being edited.
 */
const THRESHOLD = 600;

/**
 * Baseline generated from the tree at #1854, not hand-typed: every `.ts` /
 * `.svelte` file under `src/` measuring more than THRESHOLD lines, with the
 * count it had that day.
 *
 * Sorted largest-first so the shape of the problem is readable at a glance.
 * Numbers here may go DOWN freely (lower the entry, or delete it once the file
 * drops under THRESHOLD) and may go UP only on purpose.
 */
const BUDGETS: Record<string, number> = {
  'src/renderer/App.svelte': 2072,
  'src/renderer/lib/components/Preview.svelte': 1299,
  'src/renderer/lib/components/SourceDetail.svelte': 1346,
  'src/renderer/lib/components/SourcesPanel.svelte': 789,
  'src/renderer/lib/ipc/client.ts': 1288,
  'src/renderer/lib/stores/conversations.svelte.ts': 1179,
  'src/renderer/lib/components/Editor.svelte': 824,
  'src/renderer/lib/stores/editor.svelte.ts': 913,
    'src/renderer/lib/components/right-sidebar/PropertiesPanel.svelte': 1156,
  'src/main/menu.ts': 1020,
  'src/renderer/lib/components/Sidebar.svelte': 993,
  'src/renderer/lib/app/refactor-ops.svelte.ts': 827,
  'src/renderer/lib/components/SettingsDialog.svelte': 774,
  'src/main/graph/health-checks.ts': 800,
  'src/renderer/lib/components/ExportDialog.svelte': 712,
  'src/renderer/lib/components/QueryPanel.svelte': 759,
  'src/renderer/lib/components/conversations/DraftCards.svelte': 741,
  'src/shared/types.ts': 559,
  'src/shared/ipc-contract.ts': 725,
  'src/shared/channels.ts': 701,
  'src/renderer/lib/app/note-ops.ts': 687,
  'src/renderer/lib/editor/formatting.ts': 668,
  'src/main/sources/tables.ts': 662,
  'src/renderer/lib/components/FindInNotesDialog.svelte': 601,
  'src/preload/preload.ts': 627,
  'src/main/ipc/register-conversation-drafts.ts': 609,
};

/** Source files this applies to: authored `.ts` / `.svelte` under `src/`. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      // `.d.ts` files are hand-written ambient declarations for untyped deps,
      // not code with a design in it.
      else if (/\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

/**
 * `wc -l` semantics for a newline-terminated file, and one more than `wc -l`
 * for a file without a trailing newline (which is the count a human reading
 * the file in an editor would give). Whichever it is, it has to be the SAME
 * function that generated the baseline, or every entry is off by one.
 */
function lineCount(text: string): number {
  if (text === '') return 0;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/**
 * Measured sizes for everything the budget map should cover: files currently
 * over THRESHOLD, plus every budgeted file even if it has since dropped below
 * — so a file that shrank reports its real new number instead of vanishing.
 */
function measured(): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const file of sourceFiles()) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    const count = lineCount(fs.readFileSync(file, 'utf-8'));
    if (count > THRESHOLD || relative in BUDGETS) sizes[relative] = count;
  }
  return sizes;
}

describe('file-size budgets (#1854)', () => {
  it('the scan still finds files — an empty walk would pass vacuously', () => {
    // A budget map compared against nothing agrees with nothing. Floors here
    // rather than an exact count, so ordinary churn doesn't flap.
    expect(sourceFiles().length).toBeGreaterThan(500);
    expect(sourceFiles().some((f) => f.endsWith('.svelte'))).toBe(true);
    expect(Object.keys(measured()).length).toBeGreaterThan(20);
  });

  it('no budgeted file grows', () => {
    const sizes = measured();
    const grown: string[] = [];
    const fresh: string[] = [];

    for (const [file, count] of Object.entries(sizes)) {
      const budget = BUDGETS[file];
      if (budget === undefined) fresh.push(`  + ${file}: ${count} lines (no budget)`);
      else if (count > budget) grown.push(`  + ${file}: ${budget} → ${count} (+${count - budget})`);
    }

    if (grown.length > 0) {
      expect.fail(
        `File-size budget exceeded — the count went UP.\n\n${grown.join('\n')}\n\n` +
        'Two ways forward, and choosing is the point of this check: extract a seam (if the ' +
        'addition does not belong in the same file as the rest, now is when that is easiest to ' +
        'see), or raise the number in BUDGETS in this same PR because the file really is the ' +
        'right home. Both are fine. Neither happening silently is the goal.',
      );
    }

    if (fresh.length > 0) {
      expect.fail(
        `New file(s) over the ${THRESHOLD}-line threshold:\n\n${fresh.join('\n')}\n\n` +
        'Landing over the threshold on day one is the one case worth a second look, since ' +
        'nothing forced it to be one file. If it should be, add it to BUDGETS in this file at ' +
        'its current size and the ratchet takes over from there.',
      );
    }
  });

  it('a file that shrinks has its budget lowered', () => {
    const sizes = measured();
    const shrunk: string[] = [];
    const gone: string[] = [];

    for (const [file, budget] of Object.entries(BUDGETS)) {
      const count = sizes[file];
      if (count === undefined) gone.push(`  − ${file} (was ${budget}, no longer in src/)`);
      else if (count < budget) shrunk.push(`  − ${file}: ${budget} → ${count} (−${budget - count})`);
    }

    if (shrunk.length > 0) {
      expect.fail(
        `File(s) got smaller — nice.\n\n${shrunk.join('\n')}\n\n` +
        `Lower the number in BUDGETS so the ratchet holds the new ground, or delete the entry ` +
        `outright if the file is now under ${THRESHOLD} lines. Otherwise the reclaimed space ` +
        'quietly becomes headroom for the next addition.',
      );
    }

    if (gone.length > 0) {
      expect.fail(
        `BUDGETS names file(s) that are not in src/ any more:\n\n${gone.join('\n')}\n\n` +
        'Moved or deleted? Either way, update the path or drop the entry so the map keeps ' +
        'describing the tree.',
      );
    }
  });
});
