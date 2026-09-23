/**
 * @vitest-environment node
 *
 * Hand-maintained counts in the docs match the code that owns them (#2261,
 * epic #2268).
 *
 * Nine of the 2026-09-20 doc review's findings are one shape: a document
 * restates a number that a file in this repo already owns authoritatively, and
 * then drifts away from it. The sharpest case is `src/shared/link-types.ts:1-6`,
 * whose own header reads *"To add a new link type, add an entry here. Everything
 * else — parsing, rendering, ontology predicates, graph indexing — derives from
 * this list."* Everything except the README, which said 11 against 12 entries.
 * Two more counts had drifted far enough to be actively misleading: "Nearly 50
 * skills" against 56, and `docs/authoring-skills.md`'s "the stock Analysis menu
 * has 20" against 29. `website/docs/_content/settings.html` managed to carry
 * **four different counts of the same thing** (twelve / thirteen / thirteen /
 * fourteen deflist rows) against a real 16.
 *
 * Fixing those by hand buys one release. The remedy that lasts is the one this
 * repo already runs elsewhere: `tests/architecture/config-roots-doc.test.ts`
 * fails CI when the code grows a config path the doc's table omits. This is the
 * same idea pointed at counts.
 *
 * ── The one way this kind of test goes wrong ────────────────────────────────
 * A parity test that derives BOTH sides from the same place passes vacuously
 * and forever. So every assertion here is built the same way: the *expected*
 * value is computed from source under `src/`, and the *actual* value is scraped
 * out of the document's literal prose. Each scrape is asserted to have matched
 * at all before its value is compared — a reworded sentence has to fail loudly
 * rather than quietly stop checking anything. `describe('anti-vacuity')` holds
 * the floor under the code side for the same reason.
 *
 * ── Scope, honestly ─────────────────────────────────────────────────────────
 * Counts only, and only counts with a single machine-readable owner. Not
 * covered, deliberately:
 *
 * - `CLAUDE.md`'s "all 56 stock skills" — correct today, but it is incidental
 *   prose inside an anecdote about a caching bug, not an inventory claim, and
 *   #2257 is rewriting that file's statements. A pattern anchored on it would
 *   be a tripwire under someone else's edit rather than a fact worth holding.
 * - `docs/website/` — a dead duplicate of `website/`, being deleted by #2266.
 *   Its copy of `features.html` carries the same two drifted counts; pointing a
 *   ratchet at a file scheduled for removal buys nothing.
 * - Accuracy, as opposed to presence and arithmetic. A skill row whose
 *   *description* is wrong still passes; what was being forgotten was the
 *   existence of the row.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LINK_TYPES } from '../../src/shared/link-types';

const README = 'README.md';
const FEATURES = 'website/features.html';
const AUTHORING = 'docs/authoring-skills.md';
const SETTINGS_DOC = 'website/docs/_content/settings.html';
const SETTINGS_DIALOG = 'src/renderer/lib/components/SettingsDialog.svelte';
const STOCK_DIR = 'src/main/skills/stock';
const DOCS_DIR = 'website/docs';

const read = (p: string): string => readFileSync(p, 'utf8');

/**
 * Pull one capture group out of a doc and fail with the pattern if it isn't
 * there. The `expect` inside is the anti-vacuity guard: without it a reworded
 * sentence turns the assertion below into a comparison of `undefined` against
 * itself — or, worse, silently skips.
 */
function scrape(doc: string, file: string, pattern: RegExp): string {
  const m = pattern.exec(doc);
  expect(
    m,
    `${file} no longer contains a sentence matching ${pattern}.\n` +
      'This test reads the count out of that sentence. If you reworded it, update the ' +
      'pattern here in the same PR — a pattern that stops matching is a check that stops checking.',
  ).not.toBeNull();
  return m![1]!;
}

const NUMBER_WORDS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

/** Accept either `16` or `sixteen` — prose spells small numbers out. */
function asNumber(raw: string): number {
  const word = NUMBER_WORDS[raw.toLowerCase()];
  return word ?? Number(raw);
}

// ── The code side: every expected value, computed ───────────────────────────

interface StockSkill { file: string; name: string; menu: string }

function stockSkills(): StockSkill[] {
  return readdirSync(STOCK_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const src = read(join(STOCK_DIR, f));
      return {
        file: f,
        name: /^name:\s*(.+)$/m.exec(src)?.[1]?.trim() ?? '',
        menu: /^menu:\s*(.+)$/m.exec(src)?.[1]?.trim() ?? '',
      };
    });
}

/**
 * The settings tabs, read out of `SETTINGS_GROUPS` in the dialog. Regex rather
 * than import because the list lives inside a `.svelte` component's `<script>`;
 * the `id:`/`label:` pair is quoted there and unquoted in the `TabDef`
 * interface above it, which is what keeps the type declaration out of the match.
 */
function settingsTabs(): Array<{ id: string; label: string }> {
  const src = read(SETTINGS_DIALOG);
  return [...src.matchAll(/\{\s*id:\s*'([A-Za-z]+)',\s*label:\s*'([^']+)'/g)]
    .map((m) => ({ id: m[1]!, label: m[2]! }));
}

/** Pages the docs-site generator owns — `_layout.html` and friends excluded. */
function generatedDocPages(): string[] {
  return readdirSync(DOCS_DIR).filter((f) => f.endsWith('.html') && !f.startsWith('_'));
}

const SKILLS = stockSkills();
const TABS = settingsTabs();
const DOC_PAGES = generatedDocPages();

describe('anti-vacuity: the code side is really being read (#2261)', () => {
  it('finds the lists these assertions are derived from', () => {
    expect(LINK_TYPES.length, 'LINK_TYPES looks empty').toBeGreaterThan(5);
    expect(SKILLS.length, `no stock skills parsed out of ${STOCK_DIR}`).toBeGreaterThan(20);
    expect(
      SKILLS.filter((s) => !s.name || !s.menu),
      'stock skill(s) whose frontmatter this test could not read — the name/menu regexes ' +
        'have fallen behind the file format, and every count below is now wrong:',
    ).toEqual([]);
    expect(TABS.length, `no settings tabs parsed out of ${SETTINGS_DIALOG}`).toBeGreaterThan(10);
    expect(DOC_PAGES.length, `no generated pages found in ${DOCS_DIR}`).toBeGreaterThan(50);
    // Anchors: one of each shape, so a regex that matched the wrong thing shows up.
    expect(LINK_TYPES.map((t) => t.name)).toContain('supersedes');
    expect(TABS.map((t) => t.id)).toContain('mcpServers');
    expect(SKILLS.map((s) => s.name)).toContain('Steelman');
  });
});

describe('README counts match the code (#2255, #2261)', () => {
  const readme = read(README);

  it('names the real number of typed link types', () => {
    // `src/shared/link-types.ts` is explicitly the single registry — see its
    // header. The README was the one downstream consumer that wasn't derived.
    const claimed = asNumber(scrape(readme, README, /(\d+) semantic link types/));
    expect(
      claimed,
      `${README} says ${claimed} semantic link types; LINK_TYPES has ${LINK_TYPES.length} ` +
        `(${LINK_TYPES.map((t) => t.name).join(', ')}).`,
    ).toBe(LINK_TYPES.length);
  });

  it('names the real number of stock skills', () => {
    const claimed = asNumber(scrape(readme, README, /^(\d+) \*\*skills\*\*/m));
    expect(
      claimed,
      `${README} says ${claimed} skills; ${STOCK_DIR} holds ${SKILLS.length} .md files.`,
    ).toBe(SKILLS.length);
  });

  it('names the real number of user-manual pages', () => {
    // Added by #2255's Download section. A count introduced by the same PR that
    // exists to stop counts drifting had better be one of the enforced ones.
    const claimed = asNumber(scrape(readme, README, /(\d+) pages covering/));
    expect(
      claimed,
      `${README} advertises ${claimed} pages of user manual; ${DOCS_DIR} generates ` +
        `${DOC_PAGES.length}. Adding a docs page means bumping that number here too.`,
    ).toBe(DOC_PAGES.length);
  });
});

describe('the marketing site repeats the same two counts (#2261)', () => {
  const features = read(FEATURES);

  it('names the real number of typed link types', () => {
    expect(asNumber(scrape(features, FEATURES, /plus (\d+) semantic link types/)))
      .toBe(LINK_TYPES.length);
  });

  it('names the real number of stock skills', () => {
    expect(asNumber(scrape(features, FEATURES, /(\d+) skills in all/))).toBe(SKILLS.length);
  });
});

describe('docs/authoring-skills.md matches the stock catalog (#2261)', () => {
  it('names the real size of the Analysis menu', () => {
    const doc = read(AUTHORING);
    const claimed = asNumber(scrape(doc, AUTHORING, /\*\*Analysis\*\* menu has (\d+)\)/));
    const real = SKILLS.filter((s) => s.menu === 'Analysis').length;
    expect(
      claimed,
      `${AUTHORING} says the stock Analysis menu has ${claimed}; it has ${real}. ` +
        'The sentence exists to motivate grouping, so the number being wrong by half ' +
        'undercuts the advice it is attached to.',
    ).toBe(real);
  });
});

describe('the Settings docs page matches the Settings dialog (#2261)', () => {
  const doc = read(SETTINGS_DOC);

  /**
   * Three separate sentences state the tab count — the frontmatter description,
   * the lede, and the section heading. All three were different from each other
   * *and* from the code, which is how one page held four counts of one thing.
   * Checking each independently is the point: a fix that updates one and misses
   * the others is the exact defect.
   */
  it.each([
    ['frontmatter description', /description: The (\w+) places/],
    ['lede', /(\w+) tabs cover different corners/],
    ['section heading', /<h2 id="glance">The (\w+) tabs<\/h2>/],
  ])('the %s states the real tab count', (_where, pattern) => {
    expect(asNumber(scrape(doc, SETTINGS_DOC, pattern))).toBe(TABS.length);
  });

  it('lists one row per tab in the at-a-glance table', () => {
    // The glance deflist runs from its heading to the "In depth" card grid.
    const glance = doc.slice(doc.indexOf('<h2 id="glance">'), doc.indexOf('<h2 id="learn-more">'));
    expect(glance.length, 'could not find the glance section').toBeGreaterThan(200);
    const rows = [...glance.matchAll(/<div class="k">/g)].length;
    expect(
      rows,
      `${SETTINGS_DOC}'s glance table lists ${rows} tabs; the dialog has ${TABS.length}.`,
    ).toBe(TABS.length);
  });

  /**
   * The "In depth" card grid is deliberately NOT checked against the tab count:
   * it links one card per settings *page*, and MCP Servers has no page yet
   * (#2259). Naming every tab somewhere on the page is the invariant that
   * survives that asymmetry.
   */
  it('names every tab somewhere on the page', () => {
    // The dialog's sidebar disambiguates one label that the docs and the site
    // nav both write shorter. Presence is what's being checked, not wording.
    const DOC_SPELLING: Record<string, string> = {
      'Browser Clipper': 'Clipper',
    };
    const missing = TABS
      .filter((t) => !doc.includes(DOC_SPELLING[t.label] ?? t.label))
      .map((t) => `  ${t.label}  (id: ${t.id})`);
    expect(
      missing,
      `Settings tab(s) the docs page never mentions:\n${missing.join('\n')}\n\n` +
        `Add a row to the glance table in ${SETTINGS_DOC}. A tab nobody documented is a ` +
        'feature nobody can find — Inspections and MCP Servers both sat unlisted until #2261.',
    ).toEqual([]);
  });
});

describe('the thinking-tools pages list every stock skill (#2261)', () => {
  // One fragment per skill menu. The architecture review's P9 flagged this
  // independently: a one-file skill-add path against 56 stock skills means the
  // docs fall behind by default, and five had — Create Overview, Create an
  // Object Type, Infer Types for Notes, Describe Current Controversies, and
  // Describe Historical Background were all shipping undocumented.
  const MENUS = ['Learning', 'Research', 'Analysis'] as const;

  it.each(MENUS)('%s: every stock skill in the menu appears on its page', (menu) => {
    const file = `website/docs/_content/thinking-tools-${menu.toLowerCase()}.html`;
    const doc = read(file);
    const names = SKILLS.filter((s) => s.menu === menu).map((s) => s.name);
    expect(names.length, `no stock skills found for the ${menu} menu`).toBeGreaterThan(5);
    // `>Name<` rather than a bare substring: it anchors on the cell text, so a
    // skill mentioned in passing in a lede doesn't count as documented.
    const missing = names.filter((n) => !doc.includes(`>${n}<`)).sort();
    expect(
      missing,
      `Stock ${menu} skill(s) with no row on ${file}:\n${missing.map((m) => `  ${m}`).join('\n')}\n\n` +
        'Add a row under the matching group heading. Adding a skill is one file; keeping the ' +
        'docs honest about it is the second.',
    ).toEqual([]);
  });

  it('the Analysis page states the real size of its menu', () => {
    const file = 'website/docs/_content/thinking-tools-analysis.html';
    const doc = read(file);
    const claimed = asNumber(scrape(doc, file, /— (\d+) skills for working/));
    expect(claimed).toBe(SKILLS.filter((s) => s.menu === 'Analysis').length);
  });
});
