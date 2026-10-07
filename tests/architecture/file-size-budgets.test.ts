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
import { pasteStub } from '../helpers/paste-stub';

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
/**
 * #2233 raised the four IPC-contract files (`channels.ts`, `ipc-contract.ts`,
 * `preload.ts`, `client.ts`) by 41 lines between them and lowered `menu.ts` by
 * 68. That direction is the intended one: the growth is five commands
 * acquiring the channel/contract/preload/client entries they should always
 * have had, in the files this header already calls honest catalogs, paid for by
 * taking the same commands out of a menu file that was executing them inline.
 */
const BUDGETS: Record<string, number> = {
  // +1 for #2256: toggleCommandPalette on the ipc-wiring ctx.
  'src/renderer/App.svelte': 1847, // +2: a kanban view's column order and Show empty columns passed to the view tab and Save as note (#2614); +3: a kanban view's groupBy passed to the view tab and Save as note, checked against the type (#2601); +1: the preview's resize handles write through onApplyEdit (#2666); +2: type views hand their multi-selection to the bulk property editor (#2431); +2: a map view's style passed to the view tab and Save as note (#2665); +4: folder/filters passed to the view tab and Save as note (#2531); +1: the folder chip widens a scoped view (#2532); +3: switching to a view tab records it in back/forward history
  // +32 for #2210 §3b: the shared wiki-link index and the comment explaining
  // why one index is safe for all three resolvers. Net code is SHORTER (two
  // duplicated file-array builds removed); the growth is the reasoning, which
  // is the part a reader needs to not re-split them.
  // +2 for #2210 §3c: `revision` threaded to `hydrateVegaBlocks` so a chart's
  // backing query is keyed per graph revision rather than re-run per render
  // tick, plus the comment saying why the argument is there.
  'src/renderer/lib/components/Preview.svelte': 1393, // +9: charts take the theme's palette, and re-theme on a theme switch (#2522); +17: the onApplyEdit prop and installing the resize controller (#2666) — the controller itself is preview/embed-resize.ts
  'src/renderer/lib/components/SourceDetail.svelte': 1346,
  'src/renderer/lib/components/SourcesPanel.svelte': 789,
  // Three changes stacked here: #2218 (PythonSettings doc + type), #2222
  // (sources.queueCounts signature + its why-comment) and #2220 (searchInNotes
  // returns a union, +1 export). 1360 is the three together, measured.
  // +2 for #2256: the onCommandPalette signature and its why-comment. #2268
  // predicted this: the IPC-surface files are budgeted and grow one line per
  // channel by construction, so a bump here is the expected remedy, not a
  // smell.
  'src/renderer/lib/ipc/client.ts': 1404,  // +5: requestConsent's main-owned-dialog contract (#2568); +6: publish remoteUnapproved + approveRemote (#2556); #2448: tables.queryNote; #2439: mcp_call confirm reply/subscription + resetAllowedTools; #2411: menu.onRevealFile; #2363/#2364: doc comments on graph.query + git.commit contracts; +5: setTitle + onTitleChanged (conversation titles); +5: live-block export render request/reply (#2510); +7: tags merge/mergePreview (#2430)
  'src/renderer/lib/stores/conversations.svelte.ts': 1276, // +4: carry a skill's user-turn material through open + /clear (#2438); +39: mcp_call confirmation card state, beside ask_user's (#2439); +26: turn start/settle screen-reader announcements (#2374); +28: conversation titles — rename, the titleChanged subscription, keepKnownTitle for the post-send reload race; +2: typing during a reply (#1744) — /clear refuses mid-turn, a restored message keeps the draft; +11: turnStartedAt for the turn-status clock (set at the three turn starts, cleared at the three settles); +2: approve comments name the broadcast that really happens (#2541)
  'src/renderer/lib/components/Editor.svelte': 854,
  'src/renderer/lib/stores/editor.svelte.ts': 963, // +2: type-view tabs carry a kanban column order and Show empty columns (#2614); +1: type-view tabs carry a kanban groupBy (#2601); +1: type-view tabs carry a map style (#2665); +5: type-view tabs keyed by type + folder (#2531); +23: rescopeTypeView — widen a folder-scoped view, merging into an open one (#2532); +17: folder renames move scoped view tabs, beside applyRenameTransitions (#2535)
    'src/renderer/lib/components/right-sidebar/PropertiesPanel.svelte': 1072, // −96: declared-field + chip widgets extracted for the bulk editor (#2431); +8 (#2491): a committed edit fills the type's body placeholders in the same change
  // +29 for #2254/#2256: the DOCS_URL rationale (why Help pointed at the
  // repo's dev-docs folder and how the parity test keeps it honest) and the
  // Command Palette item, whose comment explains that adding the item IS the
  // documentation fix — Keyboard Shortcuts derives from this template.
  'src/main/menu.ts': 985,
  'src/renderer/lib/components/Sidebar.svelte': 982, // -10: root menu items moved to NotesRootMenu.svelte
  'src/renderer/lib/app/refactor-ops.svelte.ts': 865, // -17: syncOpenTabsToDisk moved to stores/open-tab-sync.ts, shared with the Kanban move (#2603); +21: Add/Remove Property route a typed selection to the bulk editor, whose body lives in bulk-property-ops.ts (#2431); +4: Label Version / history accept the thoughtbase root; +1: the auto-link body strip uses the shared stripFrontmatter (#2690)
  // Raised again in #2208: the staleness check became two queries (sort a
  // two-variable projection, then fetch details for the survivors) plus the
  // GROUP BY/MIN that stops a note with two dc:modified values being reported
  // twice. Most of the addition is the comment explaining why the FASTER
  // shape — drop ORDER BY, keep LIMIT — is the wrong one.
  //
  // Raised twice in epic #2241 (826 → 865 in #2238, → 924 in #2240) and then
  // paid back in #2288, which moved `Inspection` to `shared/inspections.ts`
  // and took the seam both raises had pointed at: the per-project state now
  // lives in `graph/health-check-state.ts`. The type move was what unblocked
  // it — a state module importing `Inspection` from here while this imported
  // the state from there is a genuine cycle, and `no-cycles.test.ts` follows
  // type-only imports. Below 826 now, so the two raises are more than repaid.
  'src/main/graph/health-checks.ts': 759, // #2363: per-check isolation — one failing query no longer blanks the run
  'src/renderer/lib/components/ExportDialog.svelte': 712,
  'src/renderer/lib/components/ProposalsPanel.svelte': 628, // +12: announce approve/reject outcomes (#2374); +2: bare-key guard (#2377)
  'src/renderer/lib/components/QueryPanel.svelte': 766, // +7: CM content a11y attrs + AA placeholder (#2375)
  // +17 (#2491): the property card's "Also fills {{name}} in the note's body" line, its helper and style.
  'src/renderer/lib/components/conversations/DraftCards.svelte': 775,
  // +1 for #2256: the MENU_COMMAND_PALETTE channel / its MENU_COMMANDS entry.
  'src/shared/ipc-contract.ts': 798, // +1: publish remoteUnapproved (#2556); #2448: tables:queryNote; #2439: mcp_call confirm reply/event + resetAllowedTools; #2363/#2364: GraphQueryResult + git:commit doc comments; #2288: two inline Inspection shapes → Inspection[]; #2222: sources:queueCounts; +2: conversation:setTitle + conversation:titleChanged; +3: live-block export render request/reply (#2510); +3: tags merge/mergePreview (#2430)
  // +1 for #2256: the MENU_COMMAND_PALETTE channel / its MENU_COMMANDS entry.
  'src/shared/channels.ts': 773,  // +2: COMPUTE_REQUEST_CONSENT's why-comment (#2568); +3: STORAGE_LEGACY_ORIGIN_ENTRIES (#2564); #2448: TABLES_QUERY_NOTE; #2439: CONVERSATION_MCP_CONFIRM(_REPLY) + MCP_SERVERS_RESET_ALLOWED_TOOLS; #2411: MENU_REVEAL_FILE + why it isn't shell:revealFile; #2367: MENU_OPEN_RECENT_PROJECT (was a bare literal in preload + menu); #2222: SOURCES_QUEUE_COUNTS + its why-comment; +4: CONVERSATION_SET_TITLE + CONVERSATION_TITLE_CHANGED; +4: live-block export render request/reply (#2510); +6: tags merge/mergePreview (#2430)
  // +5 (#2494): both typed-note creation paths read the type's effective (inherited) template.
  'src/renderer/lib/app/note-ops.ts': 707, // +15: saveViewAsNote — "Save as note" writes a note with a live object-view embed (#2507)
  'src/renderer/lib/editor/formatting.ts': 668,
  // #2227: listTables went from a 2N per-table loop to a bounded column sweep
  // + batched, mtime-keyed count cache. Raised rather than extracted — the new
  // helpers read `TablesState`'s private maps, so a seam would mean exporting
  // `getState` and handing the module's internals to another file.
  // +4 for #2335: the DuckDB binding is reached through `main/duckdb-lazy.ts`
  // instead of a static import, so the 107MB native module leaves the
  // pre-window boot path. The extra lines are the lazy resolution and the
  // comment saying why the import looks indirect.
  'src/main/sources/tables.ts': 882,  // #2448/#2452: runNoteQuery / runAgentQuery + checkRegisteredSql sit beside runQuery (they need the connection state); +1: the companion-note override reads frontmatter through the shared findFrontmatter (#2690)
  // #2220 (601 → 633): the search callback grew a match cap, a generation
  // guard that drops superseded responses, and a truncation-aware status line.
  // Raised rather than extracted on purpose — all 32 lines are the one
  // `runSearch` closure plus the two constants it reads, and pulling a
  // three-field search controller into its own module to save 30 lines would
  // put the debounce, the generation counter and the rendering of their result
  // in two files. The seam worth taking here, if this file grows again, is the
  // ~250-line `<style>` block, not the logic.
  'src/renderer/lib/components/FindInNotesDialog.svelte': 633,
  // +1 for #2256: onCommandPalette passthrough.
  'src/preload/preload.ts': 665,  // +7: file:// → app:// localStorage copy, the call into legacy-storage.ts (#2564); #2448: tables.queryNote; #2439: mcp_call confirm + resetAllowedTools passthroughs; #2411: menu.onRevealFile; #2222: sources.queueCounts passthrough; +4: conversations.setTitle + onTitleChanged (conversation titles); +4: live-block export render request/reply (#2510); +2: tags merge/mergePreview (#2430)
  'src/main/ipc/register-conversation-drafts.ts': 579, // +2: approved drafts broadcast their moves + rewrites (#2541)
  // New entry in #2218, which took this file from 538 over the threshold.
  // The seam this check asks about was taken first: the deadline POLICY —
  // which cell to arm, when to disarm, when to escalate from interrupt to
  // kill — is `compute/cell-deadline.ts`, testable with fake timers and no
  // subprocess. What stayed here is the transport wiring it needs (the
  // pending-cell fields, the host adapter, the `done`/`exit` bookkeeping),
  // which has nowhere else to be, plus the `isDead` correction. Roughly
  // half the growth is comment: the head-of-queue rule and the `proc.killed`
  // trap are both things the next reader will otherwise rediscover the
  // expensive way.
  'src/main/compute/python-kernel.ts': 628, // #2555 shrank it; +env allowlist (#2560)
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
    // Paste-ready BUDGETS lines (#2381).
    const grownLines: string[] = [];
    const freshLines: string[] = [];

    for (const [file, count] of Object.entries(sizes)) {
      const budget = BUDGETS[file];
      if (budget === undefined) {
        fresh.push(`  + ${file}: ${count} lines (no budget)`);
        freshLines.push(`  '${file}': ${count}, // <#issue: why this is one file>`);
      } else if (count > budget) {
        grown.push(`  + ${file}: ${budget} → ${count} (+${count - budget})`);
        grownLines.push(`  '${file}': ${count}, // +${count - budget}: <what grew> (#<issue>)`);
      }
    }

    if (grown.length > 0) {
      expect.fail(
        `File-size budget exceeded — the count went UP.\n\n${grown.join('\n')}\n\n` +
        'Two ways forward, and choosing is the point of this check: extract a seam (if the ' +
        'addition does not belong in the same file as the rest, now is when that is easiest to ' +
        'see), or raise the number in BUDGETS in this same PR because the file really is the ' +
        'right home. Both are fine. Neither happening silently is the goal.' +
        pasteStub('BUDGETS in this file, replacing each line if you are raising rather than extracting (append to any existing comment)', grownLines),
      );
    }

    if (fresh.length > 0) {
      expect.fail(
        `New file(s) over the ${THRESHOLD}-line threshold:\n\n${fresh.join('\n')}\n\n` +
        'Landing over the threshold on day one is the one case worth a second look, since ' +
        'nothing forced it to be one file. If it should be, add it to BUDGETS in this file at ' +
        'its current size and the ratchet takes over from there.' +
        pasteStub('BUDGETS in this file', freshLines),
      );
    }
  });

  it('a file that shrinks has its budget lowered', () => {
    const sizes = measured();
    const shrunk: string[] = [];
    const gone: string[] = [];
    const shrunkLines: string[] = [];

    for (const [file, budget] of Object.entries(BUDGETS)) {
      const count = sizes[file];
      if (count === undefined) gone.push(`  − ${file} (was ${budget}, no longer in src/)`);
      else if (count < budget) {
        shrunk.push(`  − ${file}: ${budget} → ${count} (−${budget - count})`);
        if (count >= THRESHOLD) shrunkLines.push(`  '${file}': ${count},`);
      }
    }

    if (shrunk.length > 0) {
      expect.fail(
        `File(s) got smaller — nice.\n\n${shrunk.join('\n')}\n\n` +
        `Lower the number in BUDGETS so the ratchet holds the new ground, or delete the entry ` +
        `outright if the file is now under ${THRESHOLD} lines. Otherwise the reclaimed space ` +
        'quietly becomes headroom for the next addition.' +
        (shrunkLines.length > 0
          ? pasteStub('BUDGETS in this file, replacing each line (keep any trailing comment)', shrunkLines)
          : ''),
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
