/**
 * Property tests for link rewriting on rename (#2388):
 * `rewriteWikiLinks` / `rewriteRelativeMarkdownLinks`
 * (`src/main/notebase/link-rewriting.ts`), checked against the app's own
 * wiki-link resolver (`src/shared/wiki-link-resolver.ts`).
 *
 * Notes are generated as a mix of links to the note being renamed — every
 * syntax the rewriter supports: bare / `.md`, `type::` prefix, `#anchor`,
 * `#^block`, `|display`, and for markdown `[t](rel)`, `![alt](rel)`, `./`,
 * `%20`-encoded spaces, `#anchor`, `"title"` — plus unrelated links
 * (other notes, `cite::`/`quote::` ids, URLs, same-doc anchors) and text.
 * The rewrites map is built exactly as `rename.ts` builds it.
 *
 *   1. Every byte outside a rewritten link is identical, and every link that
 *      did not point at the renamed note is identical.
 *   2. Every wiki-link written as the old PATH (with or without `.md`) now
 *      names the new path, keeping its type, anchor, display and extension.
 *   3. Every markdown link that resolved to the old path resolves to the new
 *      one — from the linking note's NEW location when it is the moved note
 *      itself — and every other markdown link still resolves where it did.
 *   4. (skipped, #2456) Every wiki-link that RESOLVED to the old note — by
 *      path, by basename, by slug — resolves to the new one.
 *
 * Counterexample convention: see `untrusted-content.property.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import path from 'node:path';
import {
  normalizePath,
  rewriteWikiLinks,
  rewriteRelativeMarkdownLinks,
} from '../../src/main/notebase/link-rewriting';
import { WIKI_LINK_RE, parseWikiInner } from '../../src/shared/wiki-link';
import { resolveWikiLinkTarget } from '../../src/shared/wiki-link-resolver';
import { propertyParams } from '../helpers/property';

// ── Renames: [from, to], plus notes that exist alongside ───────────────────
const RENAMES: [string, string][] = [
  ['notes/foo.md', 'archive/foo.md'],
  ['notes/foo.md', 'notes/bar.md'],
  ['notes/deep/Foo Bar.md', 'notes/Foo Bar.md'],
  ['notes/deep/Foo Bar.md', 'elsewhere/renamed note.md'],
  ['top.md', 'notes/deep/top.md'],
];
const OTHERS = ['notes/other.md', 'notes/deep/sibling.md', 'readme.md', 'assets/pic.png'];

const rename = fc.constantFrom(...RENAMES);

/** Text between links: anything but brackets (which would make new links). */
const text = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 8 }).map((s) => s.replace(/[[\]()]/g, '')),
  fc.constantFrom(' ', '\n', '\n\n', ' — see ', '[single]', 'a ] b', '`code`', '(paren)', '# Heading\n'),
);

const stemOf = (p: string) => normalizePath(p);
const baseOf = (p: string) => path.posix.basename(p);

// ── Wiki links ─────────────────────────────────────────────────────────────
function wikiLink(from: string) {
  const targetSpelling = fc.constantFrom(
    stemOf(from), from, // as a path
    stemOf(baseOf(from)), baseOf(from), // by basename
    stemOf(OTHERS[0]!), stemOf(OTHERS[1]!), 'readme', 'nothing-here',
  );
  return fc
    .tuple(
      fc.constantFrom('', '', 'supports::', 'rebuts::', 'cite::', 'quote::'),
      targetSpelling,
      fc.constantFrom('', '', '#Section', '#^para-3'),
      fc.constantFrom('', '', '|the label', '|x#y'),
    )
    .map(([type, target, anchor, display]) => `[[${type}${target}${anchor}${display}]]`);
}

function wikiNote(from: string) {
  return fc.array(fc.oneof(text, wikiLink(from)), { maxLength: 12 }).map((parts) => parts.join(''));
}

/** Split `s` into alternating [text, link, text, …, text]. */
function splitLinks(s: string, re: RegExp): { texts: string[]; links: string[] } {
  const texts: string[] = [];
  const links: string[] = [];
  let last = 0;
  for (const m of s.matchAll(new RegExp(re.source, 'g'))) {
    texts.push(s.slice(last, m.index));
    links.push(m[0]);
    last = m.index + m[0].length;
  }
  texts.push(s.slice(last));
  return { texts, links };
}

const innerOf = (link: string) => link.slice(2, -2);
const isIdLink = (type: string | null) => type === 'cite' || type === 'quote';

describe('rewriteWikiLinks on rename (#2388)', () => {
  it('leaves every byte outside a rewritten link, and every other link, identical', () => {
    fc.assert(
      fc.property(rename.chain(([from, to]) => wikiNote(from).map((c) => ({ from, to, c }))), ({ from, to, c }) => {
        const out = rewriteWikiLinks(c, new Map([[stemOf(from), stemOf(to)]]));
        const before = splitLinks(c, WIKI_LINK_RE);
        const after = splitLinks(out, WIKI_LINK_RE);
        expect(after.texts).toEqual(before.texts);
        expect(after.links.length).toBe(before.links.length);
        before.links.forEach((link, i) => {
          const p = parseWikiInner(innerOf(link));
          if (isIdLink(p.type) || stemOf(p.target) !== stemOf(from)) expect(after.links[i]).toBe(link);
        });
      }),
      propertyParams(300),
    );
  });

  it('retargets every link written as the old path, keeping type, anchor, display and extension', () => {
    fc.assert(
      fc.property(rename.chain(([from, to]) => wikiNote(from).map((c) => ({ from, to, c }))), ({ from, to, c }) => {
        const out = rewriteWikiLinks(c, new Map([[stemOf(from), stemOf(to)]]));
        const before = splitLinks(c, WIKI_LINK_RE).links;
        const after = splitLinks(out, WIKI_LINK_RE).links;
        before.forEach((link, i) => {
          const b = parseWikiInner(innerOf(link));
          if (isIdLink(b.type) || stemOf(b.target) !== stemOf(from)) return;
          const a = parseWikiInner(innerOf(after[i]!));
          expect(a.target).toBe(b.target.endsWith('.md') ? to : stemOf(to));
          expect([a.type, a.anchor, a.display]).toEqual([b.type, b.anchor, b.display]);
        });
      }),
      propertyParams(300),
    );
  });

  // #2456: rename rewrites only links spelled as the old PATH. A link that
  // reached the note by basename (`[[foo]]` for `notes/foo.md`) or by slug is
  // left as is, and stops resolving when the rename changes the basename.
  it.skip('every link that resolved to the old note resolves to the new one (#2456)', () => {
    fc.assert(
      fc.property(rename.chain(([from, to]) => wikiNote(from).map((c) => ({ from, to, c }))), ({ from, to, c }) => {
        const filesBefore = [from, ...OTHERS].map((relativePath) => ({ relativePath, isDirectory: false }));
        const filesAfter = [to, ...OTHERS].map((relativePath) => ({ relativePath, isDirectory: false }));
        const out = rewriteWikiLinks(c, new Map([[stemOf(from), stemOf(to)]]));
        const before = splitLinks(c, WIKI_LINK_RE).links;
        const after = splitLinks(out, WIKI_LINK_RE).links;
        before.forEach((link, i) => {
          const b = parseWikiInner(innerOf(link));
          if (isIdLink(b.type) || resolveWikiLinkTarget(b.target, filesBefore) !== from) return;
          const a = parseWikiInner(innerOf(after[i]!));
          expect(resolveWikiLinkTarget(a.target, filesAfter), `${link} → ${after[i]}`).toBe(to);
        });
      }),
      propertyParams(300),
    );
  });
});

// ── Markdown relative links ────────────────────────────────────────────────
const MD_LINK_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
const ALL_NOTES = (from: string) => [from, ...OTHERS];

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
