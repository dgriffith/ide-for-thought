/**
 * @vitest-environment node
 *
 * Every IPC registrar is reached by some test (#1851, epic #1855).
 *
 * CLAUDE.md's review checklist asks: "Does every new `register-*` IPC handler
 * ship with a main-process test?" It's a good question, and it was answered
 * "no" 19 times out of 24 — not by anyone deciding to skip it, but because a
 * checklist item that nothing executes is a suggestion. It did work for the
 * newest registrar at the time (`register-history` shipped with its test); it
 * simply was never applied to what already existed.
 *
 * So this makes the convention fail closed for *new* registrars and leaves the
 * existing gap as a list that may only shrink. That's the whole trade: it
 * costs one PR instead of a nineteen-file test-writing marathon, and the
 * backlog becomes visible and countable rather than implied. Writing the
 * missing tests is #1840's job and proceeds independently; this only stops the
 * list growing.
 *
 * ── What "has a test" means here ────────────────────────────────────────────
 * A registrar counts as covered when some file under `tests/` imports it. That
 * is a low bar on purpose, and it is worth being honest about what it does and
 * doesn't claim — MORE honest now that all 24 registrars pass this check, not
 * less: "covered" reading as "tested" is exactly the gap #1924 found, where
 * `register-proposals.ts` — the approval gate's own IPC surface, the Trust
 * Principle's enforcement point — showed up covered here while sitting at 25%
 * statement / 0% branch coverage everywhere else, reached only by a shared
 * fixture that asserted one narrow thing about it.
 *
 *   - it does NOT claim the registrar is thoroughly tested — it can only tell
 *     you SOME test imports the module, not that its handlers' actual logic
 *     is exercised. `register-proposals` (#1924), `register-refactor`, and
 *     `register-templates` (both #1901) were all once "covered" by this check
 *     while sitting on the shared no-project contract test
 *     (`tests/main/ipc/no-project-contract.test.ts`) alone — which asserts
 *     one narrow thing (a no-project throw, or one channel's null/found/error
 *     branches) and left the rest of each module's handlers untouched. All
 *     three now have a dedicated test file; the pattern can recur for any
 *     registrar this check can't distinguish from a thoroughly-tested one;
 *   - it DOES catch the case this test exists for: a brand-new registrar
 *     landing with nothing exercising it at all.
 *
 * Only real import specifiers count — `from '…'`, `import('…')`, `require('…')`.
 * A `vi.mock('…/register-x')` deliberately does not, since stubbing a module
 * out is the opposite of testing it. (No test mocks a registrar today; the
 * scanner is written this way so that none starts to.)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IPC_DIR = path.join(ROOT, 'src', 'main', 'ipc');

/**
 * The untested set as of #1851, ordered largest-first — which is #1840's
 * target order ("the largest untested registrars, one PR each"), so working
 * down this list top to bottom is working that issue.
 *
 * This list may only SHRINK. Deleting an entry because you wrote its test is
 * the intended way to change this file; adding one is not.
 */
/**
 * Registrars with no direct test. **Empty** — every `register-*.ts` is now
 * exercised by a file under `tests/main/ipc/` (#1840, batches a/b/c).
 *
 * Keep it that way: this list is the pre-existing backlog and may only shrink,
 * so a new registrar without a test fails the check above rather than landing
 * here. There is nothing left for it to hold.
 */
const KNOWN_UNTESTED: readonly string[] = [];

/** Module names (no extension) of every `src/main/ipc/register-*.ts`. */
function registrars(): string[] {
  return fs
    .readdirSync(IPC_DIR)
    .filter((name) => /^register-.*\.ts$/.test(name))
    .map((name) => name.replace(/\.ts$/, ''))
    .sort();
}

/** Every `.ts` file under `tests/`, recursively. */
function testFiles(): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(path.join(ROOT, 'tests'));
  return out;
}

/** Static, dynamic and CJS import specifiers — but not `vi.mock`. */
const IMPORT_SPECIFIER = /(?:from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

/**
 * Basenames of everything the test tree imports. Matching on the basename
 * rather than a resolved path keeps this indifferent to how deep a test sits
 * (`../../../src/main/ipc/register-shell` and any future alias both land on
 * `register-shell`), and registrar names are unique across the repo.
 */
function modulesImportedByTests(): Set<string> {
  const imported = new Set<string>();
  for (const file of testFiles()) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const match of text.matchAll(IMPORT_SPECIFIER)) {
      imported.add(path.basename(match[1]).replace(/\.(ts|js)$/, ''));
    }
  }
  return imported;
}

function untestedRegistrars(): string[] {
  const imported = modulesImportedByTests();
  return registrars().filter((name) => !imported.has(name));
}

describe('IPC registrar test coverage (#1851)', () => {
  it('the enumeration still finds things — a broken scan would pass vacuously', () => {
    // If `registrars()` returned nothing, "every registrar has a test" would
    // be trivially true and this file would be decoration. Same for the import
    // scan: if it stopped matching, every registrar would read as untested and
    // the ratchet below would fail loudly — that direction is safe, so it's
    // the empty-enumeration direction that needs a floor.
    expect(registrars().length).toBeGreaterThan(20);
    expect(modulesImportedByTests().size).toBeGreaterThan(100);
    // And the scanner really does see registrar imports, not just package names.
    expect(modulesImportedByTests().has('register-shell')).toBe(true);
  });

  it('a new registrar ships with a test', () => {
    const unexpected = untestedRegistrars().filter((name) => !KNOWN_UNTESTED.includes(name));
    if (unexpected.length > 0) {
      expect.fail(
        `Registrar(s) with no test:\n\n${unexpected.map((n) => `  + ${n}`).join('\n')}\n\n` +
        'Add a main-process test under `tests/main/ipc/` that imports the registrar and ' +
        'exercises its handlers — `tests/main/ipc/register-shell.test.ts` is the smallest ' +
        'template, `register-notebase.test.ts` the fullest. CLAUDE.md → "Code Review Checklist ' +
        'for LLM/Graph PRs": an untested handler is how the CONVERSATION_SEND gap slipped in ' +
        '(#1612), so a new handler needs both a test and a coverage threshold.\n\n' +
        'The KNOWN_UNTESTED list in this file is the pre-existing backlog and may only shrink — ' +
        'it is not where new registrars go.',
      );
    }
  });

  it('the untested list only shrinks', () => {
    const untested = new Set(untestedRegistrars());
    const existing = new Set(registrars());

    const nowTested = KNOWN_UNTESTED.filter((name) => existing.has(name) && !untested.has(name));
    if (nowTested.length > 0) {
      expect.fail(
        `These registrars now have tests — nice.\n\n${nowTested.map((n) => `  − ${n}`).join('\n')}\n\n` +
        'Delete them from KNOWN_UNTESTED in this file so the ratchet holds the new ground. ' +
        `That would take the backlog from ${KNOWN_UNTESTED.length} to ${KNOWN_UNTESTED.length - nowTested.length}.`,
      );
    }

    const gone = KNOWN_UNTESTED.filter((name) => !existing.has(name));
    if (gone.length > 0) {
      expect.fail(
        `KNOWN_UNTESTED names registrars that no longer exist:\n\n${gone.map((n) => `  − ${n}`).join('\n')}\n\n` +
        'Renamed or removed? Either way, drop the stale entry from this file so the list keeps ' +
        'meaning "registrars that still need a test".',
      );
    }
  });
});
