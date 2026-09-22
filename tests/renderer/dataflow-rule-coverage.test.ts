/**
 * @vitest-environment node
 *
 * Fail-closed coverage for the renderer data-flow rule (#1086 / #1626).
 *
 * The eslint `no-restricted-syntax` denylist in eslint.config.mjs forbids
 * components from calling *known* mutating/subscribing `api.*` methods. A
 * denylist fails OPEN, though: a newly added mutation channel whose name nobody
 * remembered to list slips past lint silently — exactly how
 * `api.refactor.applySuggestedLink` (a note-writing mutation) reached
 * UnlinkedMentions.svelte unnoticed.
 *
 * This test makes the classification fail CLOSED. It scans every component for
 * `api.<domain>.<method>(` call sites and asserts each method NAME is accounted
 * for — either a curated read/OS side-effect (READ_ALLOWLIST below) or a
 * denylisted mutation (parsed straight from eslint.config.mjs, so the two never
 * drift). A brand-new, unclassified method fails HERE, forcing the author to
 * decide:
 *   • read / stateless OS side-effect → add it to READ_ALLOWLIST, or
 *   • mutation / event subscription → add it to the eslint denylist AND route
 *     the call through a store or App ops handler.
 *
 * The eslint rule itself covers both call forms — the typed `api` client and
 * the raw `window.api` bridge (#1674). This test is the complementary net: it
 * scans both forms and makes sure every method NAME used outside an owner
 * module is classified, so a brand-new method can't slip through unnoticed.
 *
 * #2232 widened the scan from "`.svelte` under `lib/components/`" to all of
 * `src/renderer` minus the owner paths, matching the eslint rule's new scope —
 * see SCAN_ROOT below for why the old scope let nine real mutations through.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dataflowMutationMethods, dataflowOwnerPaths } from '../helpers/renderer-api-surface';

/**
 * The scan's scope, kept identical to the eslint rule's (#2232). Both used to
 * say "`.svelte` files under `lib/components/`", which made the rule a property
 * of file LOCATION while CLAUDE.md states it as a property of RESPONSIBILITY —
 * so everything in `src/renderer/lib/**` that was a `.ts` file outside the
 * owner directories was invisible to both at once. `lib/sources/source-actions.ts`
 * is the case that proves it: extracting three source mutations out of two
 * components — exactly the refactor the rule should survive — silently removed
 * the enforcement from all three.
 *
 * Now: everything under `src/renderer`, minus the places allowed to own a
 * mutation — asserted below to be exactly the eslint block's `ignores`, so the
 * two descriptions of one set can't drift apart the way the scopes did.
 */
const SCAN_ROOT = 'src/renderer';

const OWNER_PATHS = [
  // Stores own state mutations + main→renderer event subscriptions.
  'src/renderer/lib/stores',
  // App-level ops clusters, wired by the composition root.
  'src/renderer/lib/app',
  // The typed `api` client itself — it is where every method name is defined.
  'src/renderer/lib/ipc/client.ts',
  // App.svelte is the composition root, not a leaf component (CLAUDE.md).
  'src/renderer/App.svelte',
];

/**
 * Read / stateless-OS-side-effect `api.*` methods a component may call directly
 * (data-flow rule). When the fail-closed guard flags a new method here, add it
 * only if it truly changes no in-app state; otherwise it belongs in the eslint
 * denylist and behind a store/ops.
 */
const READ_ALLOWLIST = new Set<string>([
  // app / shell / view / export — OS + window reads and stateless side-effects
  'getInfo', 'getShortcuts', 'openExternal', 'openInDefault', 'openInTerminal',
  'revealFile', 'revealFolder', 'revealAuditLog', 'csv', 'getZoomFactor',
  // inspection settings: reading which checks run changes nothing (#1792);
  // the write is denylisted and goes through the settings store.
  'inspectionSettings',
  // Raises the OS emoji picker over the focused field; the emoji arrives as
  // ordinary typed input, so no in-app state changes behind the component.
  'showEmojiPanel',
  // graph / links reads
  'query', 'aliasMap', 'frontmatterKeys', 'inspections', 'schemaForCompletion',
  'sourceDetail', 'citationsForNote', 'expandNode', 'neighborhood',
  // notebase reads
  'getProperties', 'listFiles', 'readFile', 'searchInNotes',
  // tags / types / tables / templates / collections / sites / skills reads
  'allNames', 'list', 'notesByTag', 'notesByTagPrefix', 'sourcesByTag',
  'instances', 'noteProperties', 'smartMembers',
  // sources reads
  'getExcerptNoteFolder', 'getIngestSettings', 'hasPdf', 'listAll', 'queueMembers', 'readPdf',
  // `queueCounts` (#2222) is the same question as `queueMembers` asked for a
  // size instead of a list — a pure read, so it sits beside it here.
  'queueCounts',
  // settings-ish reads + compute probes. `runCell` was here until #1837: it
  // writes an audit record to the project and leaves state in a shared kernel,
  // so it is a mutation, not a probe — it's on the denylist now.
  'getState', 'getKeyStorage', 'getSettings', 'getStyle', 'listStyles',
  'listUserLocales', 'listUserStyles', 'getPythonSettings', 'listConsent',
  'browsePython', 'probePython',
  // publish reads
  'checkGitHub', 'checkS3', 'listExporters', 'listTargets', 'resolvePlan',
  // embeddings + tools reads
  'unlinkedMentions', 'checkConnection',
  // local per-note history reads (#1158); `restore` is denylisted (a mutation)
  'getRevision',

  // ── Newly in scope with #2232's widened scan ─────────────────────────────
  // These were always allowed; the old `.svelte`-under-components/ scan simply
  // never saw the `.ts` modules calling them. Each is classified here for the
  // first time, not reclassified.
  //
  // Whole-window zoom: CLAUDE.md exempts `api.view.*` outright as a stateless
  // OS side-effect — a synchronous wrapper over the renderer's own `webFrame`,
  // with no in-app state behind it.
  'setZoomFactor',
  // notebase + links + search reads.
  'fileExists', 'readBinary', 'outgoing', 'backlinks', 'bundle', 'related', 'searchText',
  // Formats a citation/quote reference for display. Pure render — it reads the
  // CSL style and the excerpt, and writes nothing.
  'renderInline',
  // Read-THROUGH caches for remote media in a preview (`![](https://…)` images,
  // YouTube poster frames): fetch once, memoize under `<thoughtbase>/.minerva/
  // cache/`, serve from there afterwards. They do touch the disk, so the call
  // is worth a deliberate look rather than a reflex — but the bytes are derived,
  // regenerable, and invisible to the graph and to the user's content. Nothing
  // observable in the app changes, which is the test the rule actually applies.
  'cacheExternal', 'thumbnail',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (OWNER_PATHS.includes(p)) continue;
    if (e.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.svelte') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Drop block, line, and HTML comments so a commented example call never counts. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** Every `(window.)?api.<domain>.<method>(` call site outside the owner paths. */
function componentApiCalls(): { file: string; method: string }[] {
  const calls: { file: string; method: string }[] = [];
  for (const file of walk(SCAN_ROOT)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/(?:window\.)?\bapi\.\w+\.(\w+)\s*\(/g)) {
      calls.push({ file: file.slice(SCAN_ROOT.length + 1), method: m[1]! });
    }
  }
  return calls;
}

describe('renderer data-flow rule — fail-closed method coverage (#1626)', () => {
  const deny = dataflowMutationMethods();
  const calls = componentApiCalls();

  it('parses a non-trivial mutation denylist from eslint.config.mjs', () => {
    expect(deny.size).toBeGreaterThan(40);
    expect(deny.has('writeFile')).toBe(true);
    // The gap #1626 closed: applySuggestedLink is now classified as a mutation.
    expect(deny.has('applySuggestedLink')).toBe(true);
  });

  it('scans exactly the complement of the eslint rule (#2232)', () => {
    // The lint rule and this scan describe one boundary from opposite sides.
    // Widening the eslint exemption without widening OWNER_PATHS would hide a
    // module from the fail-closed check while lint stopped covering it too —
    // the same both-at-once blind spot #2232 closed.
    expect(OWNER_PATHS.slice().sort()).toEqual(dataflowOwnerPaths());
  });

  it('finds the api.* calls it is meant to police', () => {
    // A guard over an empty set would pass vacuously — make sure the scan works.
    expect(calls.length).toBeGreaterThan(20);
  });

  it('classifies every api.* method called outside an owner module (a read or a denylisted mutation)', () => {
    const unclassified = [...new Set(
      calls
        .filter((c) => !READ_ALLOWLIST.has(c.method) && !deny.has(c.method))
        .map((c) => `${c.file}: api.*.${c.method}`),
    )].sort();
    expect(
      unclassified,
      'Unclassified api.* method call(s) outside an owner module. Classify each: a read / stateless ' +
        'OS side-effect → add it to READ_ALLOWLIST in this test; a mutation or event ' +
        'subscription → add it to the eslint denylist (eslint.config.mjs) and route the call ' +
        `through a store or App ops handler.\n${unclassified.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the read allowlist and the mutation denylist disjoint', () => {
    const overlap = [...READ_ALLOWLIST].filter((n) => deny.has(n));
    expect(
      overlap,
      `A method is listed as both an allowed read and a denylisted mutation: ${overlap.join(', ')}`,
    ).toEqual([]);
  });
});
