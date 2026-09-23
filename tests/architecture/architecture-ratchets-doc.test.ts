/**
 * @vitest-environment node
 *
 * `docs/architecture-ratchets.md` has an entry for every test in this
 * directory, and no entry for a test that isn't here (#2262, epic #2268).
 *
 * These tests are unusual in one way that makes documenting them matter more
 * than documenting most code: **you almost never meet one on purpose.** They
 * fail on a PR that has nothing to do with them — you moved a module and the
 * package-cycle check fires, you added a dialog and the adoption ratchet fires,
 * you added a channel and four file-size budgets fire at once. At that moment
 * the reader needs one paragraph saying what the invariant is and which of the
 * two or three legitimate responses applies, and the honest default without it
 * is to edit the assertion until it passes — which is exactly the failure each
 * of these was written to prevent.
 *
 * When #2262 was filed the ratio was 6 documented of 16. Both numbers were
 * already stale by the time it was worked: there are 32 tests here now and
 * CLAUDE.md's prose names about two thirds of them, which is the drift this
 * check exists to stop. The count moved by 14 in roughly six months; nothing
 * about that rate suggests hand-maintenance would have kept up.
 *
 * Bidirectional on purpose. Forward (a new test needs an entry) is the obvious
 * half. Backward (an entry must name a real file) is the half that matters
 * later: a renamed or deleted test otherwise leaves behind a paragraph of
 * confident instructions for handling a failure that can no longer happen, and
 * a reader has no way to tell that from a test they simply haven't hit yet.
 *
 * ── Scope, honestly ─────────────────────────────────────────────────────────
 * Presence, not accuracy — the same trade `config-roots-doc.test.ts` (#1853)
 * states for its own inventory. An entry whose prose has gone stale still
 * passes here. What's being prevented is the shape that actually recurs: a test
 * lands, nobody writes it up, and three months later the only description of
 * why it exists is its own header — which the person hitting the failure has no
 * particular reason to read before editing the file it sits in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'tests/architecture';
const DOC = 'docs/architecture-ratchets.md';

/** Every test file in this directory, by bare filename. */
function testFiles(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith('.test.ts')).sort();
}

/**
 * Every test named by an entry heading. The doc's section shape is
 * `` ### `name.test.ts` `` — anchored on the heading rather than on any mention
 * of the filename, so a test merely *referenced* inside another entry (they
 * cross-reference each other constantly) doesn't count as documented.
 */
function documentedFiles(doc: string): string[] {
  return [...doc.matchAll(/^### `([^`]+\.test\.ts)`$/gm)].map((m) => m[1]!).sort();
}

describe('docs/architecture-ratchets.md inventories tests/architecture (#2262)', () => {
  const doc = readFileSync(DOC, 'utf8');

  it('finds both sides (a broken scan would pass vacuously)', () => {
    expect(testFiles().length, `no test files found under ${DIR}`).toBeGreaterThan(20);
    expect(documentedFiles(doc).length, `no \`### \`x.test.ts\`\` headings in ${DOC}`).toBeGreaterThan(20);
    expect(doc.length, `${DOC} looks empty`).toBeGreaterThan(5000);
  });

  it('documents every test in the directory', () => {
    const documented = new Set(documentedFiles(doc));
    const undocumented = testFiles().filter((f) => !documented.has(f));
    expect(
      undocumented,
      `Architecture test(s) with no entry in ${DOC}:\n\n` +
        `${undocumented.map((f) => `  ${f}`).join('\n')}\n\n` +
        `Add a \`### \\\`${undocumented[0] ?? 'name.test.ts'}\\\`\` section saying what it enforces, why ` +
        '(the concrete defect it was written for, if there was one), and — most importantly — what ' +
        'to do when it fires. Someone will meet this test for the first time as a red run on an ' +
        'unrelated PR, and the default response to an undocumented failing assertion is to edit it.',
    ).toEqual([]);
  });

  it('has no entry for a test that no longer exists', () => {
    const present = new Set(testFiles());
    const orphaned = documentedFiles(doc).filter((f) => !present.has(f));
    expect(
      orphaned,
      `${DOC} documents test(s) that aren't in ${DIR}:\n\n` +
        `${orphaned.map((f) => `  ${f}`).join('\n')}\n\n` +
        'A renamed test needs its heading renamed; a deleted one needs its entry deleted. An entry ' +
        'for a test that no longer runs is instructions for a failure that can no longer happen, ' +
        'and nothing distinguishes it from one you simply have not hit.',
    ).toEqual([]);
  });

  it('every prose statement of the test count is current', () => {
    // Three documents state this number, and a count in prose is the single
    // most drift-prone thing a doc can contain — #2262 opened with "the 9
    // undocumented architecture-ratchet tests" and was wrong on both halves
    // (16 tests, 6 documented) by the time it was worked: 32 and ~19. Checking
    // only the inventory's own intro would leave the other two to rot exactly
    // the way the issue's numbers did.
    const n = testFiles().length;
    const SITES: Array<[string, string]> = [
      [DOC, doc.slice(0, 2000)],
      // Each of these states it in one sentence introducing the directory.
      ['CLAUDE.md', readFileSync('CLAUDE.md', 'utf8')],
      ['docs/development.md', readFileSync('docs/development.md', 'utf8')],
    ];
    const stale = SITES
      .filter(([, text]) => /tests\/architecture/.test(text))
      .filter(([, text]) => {
        // Only the sentences that actually quote a count of tests, so a doc
        // that stops naming a number isn't forced to start.
        const claims = [...text.matchAll(/\*\*(\d+)\*\* tests|Its (\d+) tests|, (\d+) tests/g)];
        return claims.some((m) => Number(m[1] ?? m[2] ?? m[3]) !== n);
      })
      .map(([name]) => name);
    expect(
      stale,
      `Document(s) stating a stale count of tests/architecture tests (the real count is ${n}): ` +
        `${stale.join(', ')}.\n\n` +
        'Update the number wherever it appears. It is the one figure in these files that dates ' +
        'them at a glance, which also means a wrong one makes the rest look older than it is.',
    ).toEqual([]);
  });

  it('every entry says what to do when the test fires', () => {
    // The actionable half is the whole reason this is a document rather than a
    // list of filenames. Each entry carries a bolded "When it fires:" cue.
    const entries = doc.split(/^### `/m).slice(1);
    const missing = entries
      // Newlines collapsed first: the cue is prose and wraps freely, so
      // `**When it\nfires:**` is the same cue as `**When it fires:**`.
      .filter((e) => !/\*\*When it\s+fires/.test(e.replace(/\s+/g, ' ')))
      .map((e) => e.slice(0, e.indexOf('`')));
    expect(
      missing,
      `Entries in ${DOC} with no "**When it fires:**" guidance: ${missing.join(', ')}.\n\n` +
        'Describing what a ratchet enforces without saying how to respond leaves the reader exactly ' +
        'where they started, because they already know what failed — the test told them.',
    ).toEqual([]);
  });

  it('CLAUDE.md points at the doc', () => {
    // The inventory is only reachable if the file agents and contributors
    // actually read sends them to it.
    expect(readFileSync('CLAUDE.md', 'utf8')).toContain(DOC);
  });
});
