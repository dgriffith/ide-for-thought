/**
 * @vitest-environment node
 *
 * `docs/config-roots.md` matches the code (#1853, epic #1855).
 *
 * The doc (#1642) is a hand-maintained inventory of every place Minerva keeps
 * configuration, written because those places are otherwise scattered and
 * because secrets sit in three of them. Hand-maintained inventories drift, and
 * this one already had: by the time this test was written it omitted
 * `compute-consent.json`, `inspection-settings.json`, `history-settings.json`,
 * and `<thoughtbase>/.minerva/history/` entirely. An inventory nobody checks is
 * a document that tells you something false with confidence — worse than no
 * document, because it gets believed.
 *
 * The check: fourteen sites in `src/main/**` hand-roll
 * `path.join(app.getPath('userData'), '<name>')`. Every `<name>` must appear in
 * the doc.
 *
 * ── Scope, honestly ─────────────────────────────────────────────────────────
 * This covers root 1 (`userData/`) only, because that root has a single
 * machine-checkable spelling — `getPath('userData')`. Root 2 (`~/.minerva/`)
 * and root 3 (`<thoughtbase>/.minerva/`) are still hand-maintained: their paths
 * are built from `os.homedir()` and from a project root passed down through
 * dozens of call sites, with no one literal to anchor on. The doc's other two
 * tables can still drift; only this one can't.
 *
 * It also checks presence, not accuracy — a row whose description is wrong
 * still passes. Naming the file is the part that was actually being forgotten.
 *
 * If `src/main/config/user-data-path.ts` ever lands (one call site instead of
 * fourteen, as #1853 suggests), point `USER_DATA_CALL` at it and this gets
 * simpler rather than obsolete.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const MAIN_DIR = 'src/main';
const DOC = 'docs/config-roots.md';

/**
 * `app.getPath('userData')` immediately followed by the path segment joined
 * onto it. Anchoring on the `, '<name>'` is what separates a real call site
 * from the several places that merely *mention* `getPath('userData')` in prose.
 */
const USER_DATA_CALL = /getPath\(\s*['"]userData['"]\s*\)\s*,\s*['"]([^'"]+)['"]/g;

/** Bare mentions, to catch a call site written in a shape the pattern misses. */
const USER_DATA_MENTION = /getPath\(\s*['"]userData['"]\s*\)/g;

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Drop block and line comments so a doc-comment mention never counts as a call. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

interface Site { file: string; name: string }

function userDataSites(): { sites: Site[]; mentionFiles: string[] } {
  const sites: Site[] = [];
  const mentionFiles: string[] = [];
  for (const file of tsFilesUnder(MAIN_DIR)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    if (USER_DATA_MENTION.test(src)) mentionFiles.push(relative('.', file));
    USER_DATA_MENTION.lastIndex = 0;
    for (const m of src.matchAll(USER_DATA_CALL)) {
      sites.push({ file: relative('.', file), name: m[1]! });
    }
  }
  return { sites, mentionFiles };
}

describe('docs/config-roots.md matches the code (#1853)', () => {
  const { sites, mentionFiles } = userDataSites();
  const doc = readFileSync(DOC, 'utf8');

  it('finds the userData call sites it is meant to police', () => {
    // Without this, a regex that stopped matching would make the whole file
    // pass by checking nothing.
    expect(sites.length, `no getPath('userData') call sites found under ${MAIN_DIR}`).toBeGreaterThan(10);
    expect(doc.length, `${DOC} looks empty`).toBeGreaterThan(1000);
    // Anchors: one file, one directory — the two shapes the doc has to cover.
    const names = new Set(sites.map((s) => s.name));
    expect(names.has('recent-projects.json')).toBe(true);
    expect(names.has('queries')).toBe(true);
  });

  /**
   * The doc names paths in backticks, and writes directories with a trailing
   * slash (`` `queries/` ``) where the code joins a bare segment (`'queries'`).
   * Accept either spelling — the check is "is this path named", not "is it
   * punctuated my way".
   */
  const documented = (name: string): boolean =>
    doc.includes(`\`${name}\``) || doc.includes(`\`${name}/\``);

  it('documents every userData path built in src/main', () => {
    const undocumented = [...new Set(
      sites
        .filter((s) => !documented(s.name))
        .map((s) => `  ${s.name}  (${s.file})`),
    )].sort();
    expect(
      undocumented,
      `Config path(s) under userData/ that ${DOC} doesn't mention.\n\n` +
        `${undocumented.join('\n')}\n\n` +
        `Add a row to the "1. \`userData/\` — per machine" table in ${DOC} saying what the file ` +
        'holds — and, if it holds a secret, list it under "Secrets, at a glance" too. The doc is ' +
        'the only inventory of where Minerva keeps state; a config that isn\'t in it is a config ' +
        'nobody can find, back up, or reason about.',
    ).toEqual([]);
  });

  it('sees every file that mentions userData at all (no call site in an unparsed shape)', () => {
    // If a file talks about userData but yields no `, '<name>'` site, either it
    // only mentions it in a string/identifier, or it builds the path in a shape
    // this test can't read — and an unreadable call site is an undocumented one
    // waiting to happen. Listed explicitly so a new one has to be looked at.
    const KNOWN_MENTION_ONLY: Record<string, string> = {
      // The shared config loader takes an absolute path from its callers; it
      // names userData only to explain what it's protecting.
      'src/main/config/config-store.ts': 'loader — takes an absolute path, builds none',
    };
    const withSite = new Set(sites.map((s) => s.file));
    const unexplained = mentionFiles
      .filter((f) => !withSite.has(f) && !(f in KNOWN_MENTION_ONLY))
      .sort();
    expect(
      unexplained,
      'File(s) referencing getPath(\'userData\') without a path this test can read:\n' +
        `${unexplained.join('\n')}\n` +
        'Build the path as `path.join(app.getPath(\'userData\'), \'<name>\')` so the inventory check ' +
        'can see it, or add the file to KNOWN_MENTION_ONLY in this test with a reason.',
    ).toEqual([]);
  });
});
