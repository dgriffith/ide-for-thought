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
 * The eslint rule itself now covers both call forms — the typed `api` client
 * and the raw `window.api` bridge (#1674). This test is the complementary net:
 * it scans both forms and makes sure every method NAME used in a component is
 * classified, so a brand-new method can't slip through unnoticed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENTS_DIR = 'src/renderer/lib/components';
const ESLINT_CONFIG = 'eslint.config.mjs';

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
  // settings-ish reads + compute probes/execution (persist step saveCellOutput is denylisted)
  'getState', 'getKeyStorage', 'getSettings', 'getStyle', 'listStyles',
  'listUserLocales', 'listUserStyles', 'getPythonSettings', 'listConsent',
  'browsePython', 'probePython', 'runCell',
  // publish reads
  'checkGitHub', 'checkS3', 'listExporters', 'listTargets', 'resolvePlan',
  // embeddings + tools reads
  'unlinkedMentions', 'checkConnection',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.svelte')) out.push(p);
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

/** Mutation/subscription method names the eslint denylist forbids in components. */
function denylistNames(): Set<string> {
  const cfg = readFileSync(ESLINT_CONFIG, 'utf8');
  // The mutation method names live in the DATAFLOW_MUTATION_METHODS const — a
  // `'a|b|' + 'c|d'` series of single-quoted fragments shared by both selectors.
  // Slice the assignment (from `=` to the terminating `;`), pull the quoted
  // contents, and split on `|`; the interleaved `//` section comments carry no
  // quotes, so they drop out.
  const decl = cfg.indexOf('const DATAFLOW_MUTATION_METHODS');
  expect(decl, 'DATAFLOW_MUTATION_METHODS not found in eslint.config.mjs').toBeGreaterThan(-1);
  const eq = cfg.indexOf('=', decl);
  const semi = cfg.indexOf(';', eq);
  expect(semi).toBeGreaterThan(eq);
  const region = cfg.slice(eq, semi);
  const names = new Set<string>();
  for (const m of region.matchAll(/'([^']*)'/g)) {
    for (const n of m[1]!.split('|')) if (/^\w+$/.test(n)) names.add(n);
  }
  return names;
}

/** Every `(window.)?api.<domain>.<method>(` call site across components. */
function componentApiCalls(): { file: string; method: string }[] {
  const calls: { file: string; method: string }[] = [];
  for (const file of walk(COMPONENTS_DIR)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/(?:window\.)?\bapi\.\w+\.(\w+)\s*\(/g)) {
      calls.push({ file: file.slice(COMPONENTS_DIR.length + 1), method: m[1]! });
    }
  }
  return calls;
}

describe('renderer data-flow rule — fail-closed method coverage (#1626)', () => {
  const deny = denylistNames();
  const calls = componentApiCalls();

  it('parses a non-trivial mutation denylist from eslint.config.mjs', () => {
    expect(deny.size).toBeGreaterThan(40);
    expect(deny.has('writeFile')).toBe(true);
    // The gap #1626 closed: applySuggestedLink is now classified as a mutation.
    expect(deny.has('applySuggestedLink')).toBe(true);
  });

  it('finds the api.* calls it is meant to police', () => {
    // A guard over an empty set would pass vacuously — make sure the scan works.
    expect(calls.length).toBeGreaterThan(20);
  });

  it('classifies every api.* method called in a component (a read or a denylisted mutation)', () => {
    const unclassified = [...new Set(
      calls
        .filter((c) => !READ_ALLOWLIST.has(c.method) && !deny.has(c.method))
        .map((c) => `${c.file}: api.*.${c.method}`),
    )].sort();
    expect(
      unclassified,
      'Unclassified api.* method call(s) in a component. Classify each: a read / stateless ' +
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
