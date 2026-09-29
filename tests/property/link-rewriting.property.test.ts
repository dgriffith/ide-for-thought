/**
 * Property tests for link rewriting on rename (#2388, #2456):
 * `relocateWikiLinks` / `rewriteRelativeMarkdownLinks`
 * (`src/main/notebase/link-rewriting.ts`), checked against the app's own
 * wiki-link resolver (`src/shared/wiki-link-resolver.ts`).
 *
 * Notes are generated as a mix of links to the note being renamed — every
 * syntax the rewriter supports: path / basename / slug / alias spellings, with
 * or without an extension, `type::` prefix, `#anchor`, `#^block`, `|display`,
 * `![[embed]]`, and for markdown `[t](rel)`, `![alt](rel)`, `./`,
 * `%20`-encoded spaces, `#anchor`, `"title"` — plus links to other notes
 * (including ones the rename makes ambiguous), `cite::`/`quote::` ids, links
 * inside code, URLs, same-doc anchors and text. The thoughtbase's scan order
 * is shuffled, since the resolver breaks ties by it.
 *
 *   1. Every byte outside a rewritten link is identical, and so is every link
 *      that is in code, an id, broken, or still resolves where it did under
 *      every post-rename scan order.
 *   2. Every wiki-link written as the old PATH (with or without extension)
 *      now names the new path, keeping its type, anchor, display and extension.
 *   3. Every wiki-link that RESOLVED to the old note — by path, basename, slug
 *      or alias — resolves to the new one, and every link that resolved
 *      elsewhere still resolves there, under ANY post-rename scan order (#2456).
 *      One that named its note (anything short of the whole-path slug
 *      fallbacks) still names it, rather than reaching it by coincidence.
 *   4. Every markdown link that resolved to the old path resolves to the new
 *      one — from the linking note's NEW location when it is the moved note
 *      itself — and every other markdown link still resolves where it did.
 *
 * Counterexample convention: see `untrusted-content.property.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import path from 'node:path';
import {
  relocateWikiLinks,
  rewriteRelativeMarkdownLinks,
  type WikiRelocation,
} from '../../src/main/notebase/link-rewriting';
import { relocationIndexesFrom } from '../../src/main/graph/note-index';
import { WIKI_LINK_RE, parseWikiInner } from '../../src/shared/wiki-link';
import {
  resolveWikiLinkTarget, buildWikiLinkIndex, resolveWikiLinkTargetWithIndex,
} from '../../src/shared/wiki-link-resolver';
import { stripNoteExt, isNotePath } from '../../src/shared/note-extensions';
import { propertyParams } from '../helpers/property';

// ── Renames: [from, to], plus notes that exist alongside ───────────────────
const RENAMES: [string, string][] = [
  ['notes/foo.md', 'archive/foo.md'],
  ['notes/foo.md', 'notes/bar.md'], // new basename collides with archive/bar.md
  ['notes/deep/Foo Bar.md', 'notes/Foo Bar.md'],
  ['notes/deep/Foo Bar.md', 'elsewhere/renamed note.md'],
  ['top.md', 'notes/deep/top.md'],
  ['a/x.md', 'b/foo.md'], // takes a basename c/foo.md already answers to
  ['data/budget.csv', 'data/costs.csv'], // a non-md note (#1446)
  ['notes/paxos.md', 'notes/multi-paxos.md'], // old name still slug-suffix-matches the new
];
const OTHERS = [
  'notes/other.md', 'notes/deep/sibling.md', 'readme.md', 'archive/bar.md', 'c/foo.md',
  'data/budget.csv', 'assets/pic.png',
];
/** Frontmatter aliases. The renamed note's travels with it. */
const RENAMED_ALIAS = 'the renamed one';
const ALIASES: [string, string][] = [['readme.md', 'intro']];

const rename = fc.constantFrom(...RENAMES);
const othersFor = (from: string, to: string) => OTHERS.filter((o) => o !== from && o !== to);

/** Text between links: anything but brackets (which would make new links). */
const text = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 8 }).map((s) => s.replace(/[[\]()]/g, '')),
  fc.constantFrom(' ', '\n', '\n\n', ' — see ', '[single]', 'a ] b', '`code`', '(paren)', '# Heading\n'),
);

const baseOf = (p: string) => path.posix.basename(p);

// ── Wiki links ─────────────────────────────────────────────────────────────
function wikiTarget(from: string) {
  return fc.constantFrom(
    stripNoteExt(from), from, // as a path
    stripNoteExt(baseOf(from)), baseOf(from), // by basename
    stripNoteExt(baseOf(from)).toLowerCase(), // by slug
    RENAMED_ALIAS, 'intro', // by alias
    'foo', 'foo.md', 'bar', 'bar.md', 'archive/bar', 'c/foo', 'budget', 'budget.csv', 'deep/Foo Bar',
    'notes/other', 'notes/deep/sibling', 'readme', 'nothing-here',
  );
}

function wikiLink(from: string) {
  return fc
    .tuple(
      fc.constantFrom('', '', '!'),
      fc.constantFrom('', '', 'supports::', 'rebuts::', 'cite::', 'quote::'),
      wikiTarget(from),
      fc.constantFrom('', '', '#Section', '#^para-3'),
      fc.constantFrom('', '', '|the label', '|x#y'),
    )
    .map(([bang, type, target, anchor, display]) => `${bang}[[${type}${target}${anchor}${display}]]`);
}

/** A link the indexer never reads, because it sits in code. */
function codeLink(from: string) {
  return wikiTarget(from).chain((t) => fc.constantFrom(`\`[[${t}]]\``, `\n\`\`\`\n[[${t}]]\n\`\`\`\n`));
}

function wikiNote(from: string) {
  return fc
    .array(fc.oneof(text, wikiLink(from), codeLink(from)), { maxLength: 12 })
    .map((parts) => parts.join(''));
}

/** Split `s` into alternating [text, link, text, …, text], with link offsets. */
function splitLinks(s: string, re: RegExp): { texts: string[]; links: string[]; at: number[] } {
  const texts: string[] = [];
  const links: string[] = [];
  const at: number[] = [];
  let last = 0;
  for (const m of s.matchAll(new RegExp(re.source, 'g'))) {
    texts.push(s.slice(last, m.index));
    links.push(m[0]);
    at.push(m.index);
    last = m.index + m[0].length;
  }
  texts.push(s.slice(last));
  return { texts, links, at };
}

/** The parser's own code regex (`graph/parser.ts`). */
const CODE_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const inCode = (s: string, at: number) =>
  [...s.matchAll(CODE_RE)].some((m) => at >= m.index && at < m.index + m[0].length);

const innerOf = (link: string) => link.slice(2, -2);
const isIdLink = (type: string | null) => type === 'cite' || type === 'quote';
const asFiles = (paths: readonly string[]) => paths.map((relativePath) => ({ relativePath, isDirectory: false }));

/**
 * A rename: the thoughtbase in a shuffled scan order, one note's content, and
 * three post-rename scan orders for the oracle — the renamed note first, last,
 * and somewhere in between.
 */
const scenario = rename.chain(([from, to]) => {
  const others = othersFor(from, to);
  return fc
    .tuple(
      fc.shuffledSubarray([from, ...others], { minLength: others.length + 1 }),
      fc.nat({ max: others.length }),
      wikiNote(from),
    )
    .map(([order, landAt, c]) => {
      const rest = order.filter((p) => p !== from);
      const aliasesBefore: Record<string, string> = {
        [RENAMED_ALIAS]: from,
        ...Object.fromEntries(ALIASES.map(([p, a]) => [a, p])),
      };
      const aliasesAfter = { ...aliasesBefore, [RENAMED_ALIAS]: to };
      const afterOrders = [[to, ...rest], [...rest, to], [...rest.slice(0, landAt), to, ...rest.slice(landAt)]];
      return { from, to, c, order, aliasesBefore, aliasesAfter, afterOrders };
    });
});

type Scenario = typeof scenario extends fc.Arbitrary<infer T> ? T : never;

/** Rewrite `s.c` the way `rename.ts` does: indexes built by the app's own
 *  `relocationIndexesFrom` over the shuffled scan order. */
function relocate(s: Scenario): string {
  const aliasesPerNote = new Map<string, string[]>([
    [s.from, [RENAMED_ALIAS]],
    ...ALIASES.map(([p, a]): [string, string[]] => [p, [a]]),
  ]);
  const moves = new Map([[s.from, s.to]]);
  const reloc: WikiRelocation = {
    moves,
    ...relocationIndexesFrom(s.order, aliasesPerNote, moves, { carryAliases: true }),
  };
  return relocateWikiLinks(s.c, reloc).content;
}

/** Where `target` resolves after the rename if every scan order agrees; otherwise `'order-dependent'`, which no path equals. */
function resolvedAfter(s: Scenario, target: string): string | null {
  const answers = new Set(s.afterOrders.map((o) => resolveWikiLinkTarget(target, asFiles(o), s.aliasesAfter)));
  return answers.size === 1 ? [...answers][0]! : 'order-dependent';
}

const resolvedBefore = (s: Scenario, target: string) =>
  resolveWikiLinkTarget(target, asFiles(s.order), s.aliasesBefore);

/** Resolves by name — path, basename, alias or basename slug — in every order? */
const namesIt = (orders: string[][], aliases: Record<string, string>, target: string, want: string) =>
  orders.every((o) =>
    resolveWikiLinkTargetWithIndex(target, buildWikiLinkIndex(asFiles(o), aliases), { pathSlugFallback: false }) === want);

describe('relocateWikiLinks on rename (#2388, #2456)', () => {
  it('leaves every byte outside a rewritten link, and every unaffected link, identical', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const out = relocate(s);
        const before = splitLinks(s.c, WIKI_LINK_RE);
        const after = splitLinks(out, WIKI_LINK_RE);
        expect(after.texts).toEqual(before.texts);
        expect(after.links.length).toBe(before.links.length);
        before.links.forEach((link, i) => {
          const p = parseWikiInner(innerOf(link));
          const was = resolvedBefore(s, p.target);
          const untouchable = inCode(s.c, before.at[i]!) || isIdLink(p.type) || was === null;
          const stable = was !== s.from && resolvedAfter(s, p.target) === was;
          if (untouchable || stable) expect(after.links[i], link).toBe(link);
        });
      }),
      propertyParams(300),
    );
  });

  it('retargets every link written as the old path, keeping type, anchor, display and extension', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const out = relocate(s);
        const before = splitLinks(s.c, WIKI_LINK_RE);
        const after = splitLinks(out, WIKI_LINK_RE).links;
        before.links.forEach((link, i) => {
          const b = parseWikiInner(innerOf(link));
          if (inCode(s.c, before.at[i]!) || isIdLink(b.type)) return;
          if (stripNoteExt(b.target) !== stripNoteExt(s.from) || resolvedBefore(s, b.target) !== s.from) return;
          const a = parseWikiInner(innerOf(after[i]!));
          expect(a.target).toBe(isNotePath(b.target) ? s.to : stripNoteExt(s.to));
          expect([a.type, a.anchor, a.display]).toEqual([b.type, b.anchor, b.display]);
        });
      }),
      propertyParams(300),
    );
  });

  it('every link that resolved to the old note resolves to the new one, and every other link where it did, in any scan order (#2456)', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const out = relocate(s);
        const before = splitLinks(s.c, WIKI_LINK_RE);
        const after = splitLinks(out, WIKI_LINK_RE).links;
        before.links.forEach((link, i) => {
          const b = parseWikiInner(innerOf(link));
          if (inCode(s.c, before.at[i]!) || isIdLink(b.type)) return;
          const was = resolvedBefore(s, b.target);
          if (was === null) return;
          const a = parseWikiInner(innerOf(after[i]!));
          expect(resolvedAfter(s, a.target), `${link} → ${after[i]}`).toBe(was === s.from ? s.to : was);
          if (was === s.from && namesIt([s.order], s.aliasesBefore, b.target, s.from)) {
            expect(namesIt(s.afterOrders, s.aliasesAfter, a.target, s.to), `${link} → ${after[i]}`).toBe(true);
          }
          expect([a.type, a.anchor, a.display]).toEqual([b.type, b.anchor, b.display]);
        });
      }),
      propertyParams(300),
    );
  });
});

// ── Markdown relative links ────────────────────────────────────────────────
const MD_LINK_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
const ALL_NOTES = (from: string) => [from, ...OTHERS.filter((o) => o !== from)];

/** A relative link from `source` to `target`, spelled one of the ways authors do. */
function relSpelling(source: string, target: string) {
  const rel = path.posix.relative(path.posix.dirname(source), target);
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  return fc.constantFrom(rel.includes(' ') ? encoded : rel, encoded, rel.startsWith('.') ? encoded : `./${encoded}`);
}

function mdLink(source: string, from: string) {
  const targets = ALL_NOTES(from).filter((t) => t !== source);
  return fc
    .tuple(
      fc.constantFrom('', '!'),
      fc.constantFrom('text', 'a label', ''),
      fc.constantFrom(...targets).chain((t) => relSpelling(source, t)),
      fc.constantFrom('', '', '#heading'),
      fc.constantFrom('', '', ' "a title"'),
    )
    .map(([bang, label, url, anchor, title]) => `${bang}[${label}](${url}${anchor}${title})`);
}

function mdNote(source: string, from: string) {
  return fc
    .array(
      fc.oneof(
        text,
        mdLink(source, from),
        fc.constantFrom('[web](https://example.com/a.md)', '[same](#here)', '[proto](//host/x.md)', '[[wiki]]'),
      ),
      { maxLength: 10 },
    )
    .map((parts) => parts.join(''));
}

/** Where a markdown link's URL points, root-relative, from `sourceDir`. */
function mdTarget(sourceDir: string, url: string): string | null {
  const bare = url.split('#')[0]!;
  if (!bare || /^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith('//')) return null;
  return path.posix.normalize(path.posix.join(sourceDir, decodeURI(bare)));
}

describe('rewriteRelativeMarkdownLinks on rename (#2388)', () => {
  const scenario = rename.chain(([from, to]) =>
    fc.constantFrom(...ALL_NOTES(from).filter((n) => n.endsWith('.md'))).chain((source) =>
      mdNote(source, from).map((c) => ({ from, to, source, c })),
    ),
  );

  it('every link still resolves to the same note, or to the renamed one, from wherever its note now lives', () => {
    fc.assert(
      fc.property(scenario, ({ from, to, source, c }) => {
        const moved = source === from;
        const out = rewriteRelativeMarkdownLinks(c, source, moved ? to : source, new Map([[from, to]]));
        const before = [...c.matchAll(MD_LINK_RE)];
        const after = [...out.matchAll(MD_LINK_RE)];
        expect(after.length).toBe(before.length);
        before.forEach((m, i) => {
          const a = after[i]!;
          // Kind, label, anchor and title survive.
          expect([a[1], a[2], a[4]]).toEqual([m[1], m[2], m[4]]);
          expect(a[3]!.includes('#') ? a[3]!.slice(a[3]!.indexOf('#')) : '').toBe(
            m[3]!.includes('#') ? m[3]!.slice(m[3]!.indexOf('#')) : '',
          );
          const was = mdTarget(path.posix.dirname(source), m[3]!);
          const now = mdTarget(path.posix.dirname(moved ? to : source), a[3]!);
          if (was === null) {
            expect(a[0]).toBe(m[0]);
            return;
          }
          expect(now, `${m[0]} → ${a[0]}`).toBe(was === from ? to : was);
        });
      }),
      propertyParams(300),
    );
  });

  it('leaves every byte outside a markdown link identical', () => {
    fc.assert(
      fc.property(scenario, ({ from, to, source, c }) => {
        const out = rewriteRelativeMarkdownLinks(c, source, source === from ? to : source, new Map([[from, to]]));
        expect(splitLinks(out, MD_LINK_RE).texts).toEqual(splitLinks(c, MD_LINK_RE).texts);
      }),
      propertyParams(300),
    );
  });
});
