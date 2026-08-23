/**
 * @vitest-environment node
 *
 * Every mutating `api.*` domain has a store that owns it (#1852, epic #1855).
 *
 * CLAUDE.md's renderer data-flow rule says every state mutation and every
 * main→renderer subscription routes through a store
 * (`src/renderer/lib/stores/*.svelte.ts`) or an App ops handler
 * (`src/renderer/lib/app/*`). Eslint enforces the *negative* half — a component
 * may not call a mutating method. Nothing enforced the positive half: that the
 * mutation lands somewhere that owns the resulting state.
 *
 * #1834 is what that gap costs. Local history shipped seven IPC channels, four
 * of them mutating, with no store — and the panel polled a timer to compensate.
 * The convention held 26 domains out of 27. This makes the 27th fail.
 *
 * ── What this test can and cannot tell you ──────────────────────────────────
 * Be honest about the limits, because a fitness function that is trusted for
 * more than it checks is worse than none:
 *
 *   • It CANNOT tell a well-designed store from a one-line passthrough. A file
 *     under `stores/` that forwards `api.x.mutate()` and updates nothing
 *     satisfies this test completely. "There is an owner" is a much weaker
 *     claim than "the owner is any good".
 *   • It would NOT have caught the other half of #1834 — the missing
 *     `history:changed` event. Whether a mutating channel ships a change event
 *     is a main-side channel-shape question, invisible from the renderer, and
 *     it is not checked anywhere here.
 *   • It is a lexical scan (see the note in `tests/helpers/renderer-api-surface.ts`):
 *     an `api.*` call reached through a destructured alias or a computed member
 *     is not seen.
 *
 * What it DOES catch is the half that actually recurred: mutations landing in
 * `App.svelte` (or nowhere) instead of behind a store. `App.svelte` is the
 * composition root, which makes it the exemption every new feature reaches for.
 *
 * ── The two rules ───────────────────────────────────────────────────────────
 *   1. DOMAIN OWNERSHIP — every `api.<domain>` namespace exposing at least one
 *      denylisted method has some file under `stores/` or `lib/app/` calling a
 *      denylisted method on it. This is the #1834 shape.
 *   2. NO APP-ONLY MUTATIONS — a mutating method called from `App.svelte` is
 *      also called from a store/ops file. A budget, in the style of
 *      `pattern-ratchets.test.ts`: the two that exist today are listed with
 *      their reasons, and the list may shrink but not grow.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { apiNamespaceMethods, dataflowMutationMethods } from '../helpers/renderer-api-surface';

/** Where a mutation is allowed to live: the stores and the App ops handlers. */
const OWNER_DIRS = ['src/renderer/lib/stores', 'src/renderer/lib/app'];
const APP_SVELTE = 'src/renderer/App.svelte';

/**
 * Domains whose mutating methods legitimately have no store owner, each with
 * its reason. Empty today — every mutating domain has an owner, which is the
 * point: this test is holding ground that already exists.
 *
 * Note that project lifecycle (`notebase.open` / `close` / `newProject`), the
 * canonical "genuine App-level orchestration" case, needs no entry here: those
 * methods are not on the eslint mutation denylist at all, so they never reach
 * this check. That is a deliberate classification, not an oversight — they
 * replace the entire window's state rather than mutating a store's slice, and
 * they are wired in `lib/app/project-ops.ts` regardless.
 *
 * If you add an entry, say WHY the domain is App-level orchestration rather
 * than owned state. "It was easier" is not a reason.
 */
const DOMAIN_EXCEPTIONS: Record<string, string> = {};

/**
 * Mutating methods called from `App.svelte` and nowhere in `stores/` or
 * `lib/app/`. A budget, not an approval list — both entries are real
 * data-flow-rule debt, small enough to leave for a targeted PR and named here
 * so a third one has to be argued for in a diff.
 */
/**
 * Mutating calls that legitimately live in `App.svelte` alone.
 *
 * Empty, and worth keeping that way. It was seeded with two entries and both
 * turned out to be debt rather than orchestration — `queries.save` skipped the
 * store its five siblings already used (#1870), and `attachExcerptEvidence`
 * left the proposals refresh to whichever caller remembered it (#1871). Both
 * moved behind their stores.
 *
 * If you add one, it has to be a real App-level concern — something the
 * composition root does because no single store owns it — and the value is the
 * reason, which someone will read when deciding whether it still holds.
 */
const APP_ONLY_MUTATIONS: Record<string, string> = {};

function filesUnder(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, ext));
    else if (full.endsWith(ext)) out.push(full);
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

/** `domain.method` for every `(window.)?api.<domain>.<method>(` call in `files`. */
function apiCallsIn(files: string[]): Set<string> {
  const calls = new Set<string>();
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/(?:window\.)?\bapi\.(\w+)\.(\w+)\s*\(/g)) {
      calls.add(`${m[1]!}.${m[2]!}`);
    }
  }
  return calls;
}

const ownerFiles = OWNER_DIRS.flatMap((d) => filesUnder(d, '.ts'));
const ownerCalls = apiCallsIn(ownerFiles);
const appCalls = apiCallsIn([APP_SVELTE]);

const deny = dataflowMutationMethods();
const namespaces = apiNamespaceMethods();

/** domain → its denylisted (mutating) method names, for domains that have any. */
const mutatingDomains = new Map<string, string[]>();
for (const [domain, methods] of Object.entries(namespaces)) {
  const mutating = [...methods].filter((m) => deny.has(m));
  if (mutating.length > 0) mutatingDomains.set(domain, mutating.sort());
}

describe('every mutating api domain has a store (#1852)', () => {
  it('parses a non-trivial surface — a broken parser would pass vacuously', () => {
    // The failure mode that would quietly turn this whole file into decoration:
    // an empty denylist, an empty bridge parse, or an owner scan that finds no
    // files would make every assertion below trivially true.
    expect(deny.size, 'eslint mutation denylist looks empty').toBeGreaterThan(40);
    expect(Object.keys(namespaces).length, 'preload namespace parse looks empty').toBeGreaterThan(30);
    expect(ownerFiles.length, 'no store/ops files found').toBeGreaterThan(20);
    expect(mutatingDomains.size, 'no mutating domains found').toBeGreaterThan(15);
    expect(ownerCalls.size, 'no api.* calls found in stores/ops').toBeGreaterThan(50);
    // history is the #1834 domain — if it stops parsing as mutating, this test
    // has stopped watching the thing it was written for.
    expect(mutatingDomains.has('history')).toBe(true);
  });

  it('gives every mutating domain an owner under stores/ or lib/app/', () => {
    const orphans: string[] = [];
    for (const [domain, mutating] of mutatingDomains) {
      if (domain in DOMAIN_EXCEPTIONS) continue;
      const owned = mutating.some((m) => ownerCalls.has(`${domain}.${m}`));
      if (!owned) orphans.push(`  api.${domain} — mutating: ${mutating.join(', ')}`);
    }
    expect(
      orphans.sort(),
      'Mutating api domain(s) with no owner under src/renderer/lib/stores/ or src/renderer/lib/app/.\n\n' +
        `${orphans.join('\n')}\n\n` +
        'A domain with mutating channels needs a store that owns them and the state they change ' +
        '(CLAUDE.md → Renderer data flow). This is exactly what #1834 shipped without: history had ' +
        'four mutating channels, no store, and a polling timer standing in for a change event. ' +
        'Add a store under src/renderer/lib/stores/ (or an ops handler under src/renderer/lib/app/) ' +
        'that owns the api calls and the resulting state, and have components call it. If the domain ' +
        'genuinely is App-level orchestration, add it to DOMAIN_EXCEPTIONS in this test with a reason.',
    ).toEqual([]);
  });

  it('does not let a new mutation land only in App.svelte', () => {
    const appOnly = [...appCalls]
      .filter((c) => deny.has(c.split('.')[1]!) && !ownerCalls.has(c))
      .filter((c) => !(c in APP_ONLY_MUTATIONS))
      .sort();
    expect(
      appOnly,
      'Mutating api.* call(s) in App.svelte with no counterpart in a store or ops handler.\n\n' +
        `${appOnly.map((c) => `  api.${c}`).join('\n')}\n\n` +
        'App.svelte is the composition root, which makes it the exemption every new feature reaches ' +
        'for — that is the habit this check exists to interrupt. Move the call into the store that ' +
        'owns the state it changes and have App call the store method. If it truly is top-level ' +
        'orchestration, add it to APP_ONLY_MUTATIONS in this test with a reason.',
    ).toEqual([]);
  });

  it('keeps the documented exceptions live (no stale entries)', () => {
    const staleDomains = Object.keys(DOMAIN_EXCEPTIONS).filter((d) => !mutatingDomains.has(d));
    expect(
      staleDomains,
      `DOMAIN_EXCEPTIONS entries that are no longer mutating domains — remove: ${staleDomains.join(', ')}`,
    ).toEqual([]);

    // The budget only ratchets DOWN if fixing an entry also removes it. Anything
    // still listed but no longer App-only is debt someone paid — take it off.
    const staleAppOnly = Object.keys(APP_ONLY_MUTATIONS)
      .filter((c) => !appCalls.has(c) || ownerCalls.has(c))
      .sort();
    expect(
      staleAppOnly,
      'APP_ONLY_MUTATIONS entries that now have a store owner (or are gone from App.svelte) — ' +
        `nice, remove them so the budget holds the new ground: ${staleAppOnly.join(', ')}`,
    ).toEqual([]);
  });
});
