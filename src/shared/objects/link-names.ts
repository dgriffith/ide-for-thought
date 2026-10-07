/**
 * *Link attendees* (#2612): turn plain names on a `link-to-type` property into
 * wiki-links to the notes of its target type they name, and leave the rest.
 *
 * Meeting became an Event subtype and so inherited Event's link-to-Person
 * `attendees`. Every meeting note written before that holds names
 * (`attendees: Alice, Bob`, or a YAML list of them). Those keep rendering as
 * text; this is the optional, user-initiated step that links the ones that
 * name a Person. It works for any link-to-type property (an Event's
 * `location`, a Meeting's `organizer`), since the problem is the same shape.
 *
 * A direct frontmatter rewrite, like the type rename flow (`types/migrate.ts`)
 * — the user asked for it and confirmed it, so it is not an approval-engine
 * proposal. Pure: the Properties panel supplies the target type's instances,
 * the note list and the alias map, and writes the result through its own
 * buffer, so the rewrite is one undoable edit.
 *
 * ## What counts as a match
 *
 * A name links to a note of the target type when, exactly as a wiki-link
 * would resolve it (`resolveWikiLinkTargetWithIndex`), it names that note by
 * path, filename, frontmatter alias, or the filename's slug — or, failing
 * that, when it equals exactly one such note's title (case-insensitive). The
 * two whole-path slug fallbacks are off: they are how `[[paxos]]` reaches
 * `multi-paxos.md` by coincidence (#2456), and linking a person on a
 * coincidence is worse than leaving their name as text. A name that resolves
 * to a note of another type, or whose title is shared by two candidates, is
 * left alone. So is a value that is already a link.
 *
 * A name that resolves as written is linked as written (`[[Alice]]`), so the
 * note keeps its own wording. A title-only match links to the note's
 * shortest unambiguous path with the name as the display text
 * (`[[people/p-001|Alice]]`), since `[[Alice]]` wouldn't resolve.
 */
import YAML from 'yaml';
import {
  buildWikiLinkIndex,
  canonicalizeWikiLinkTarget,
  resolveWikiLinkTargetWithIndex,
  type NoteFileLike,
} from '../wiki-link-resolver';
import { applyFrontmatterMutation, parseFrontmatter } from '../refactor/frontmatter-rows';

/** A note of the target type: its path and its title as the type view shows it. */
export interface LinkCandidate {
  path: string;
  title: string;
}

/** Name → the wiki-link to write for it (`[[…]]`), or null to leave it as text. */
export type NameMatcher = (name: string) => string | null;

/** One name that will become a link. */
export interface LinkedName {
  name: string;
  link: string;
}

export interface LinkNamesPlan {
  /** The note with the property rewritten (line endings and BOM kept). */
  content: string;
  linked: LinkedName[];
  /** Names that stay text, in the order they appear. */
  unmatched: string[];
}

/** Characters a name can't carry inside `[[…]]` without changing its meaning. */
const LINK_UNSAFE = /[[\]|#\n\r]/;
const WHOLE_LINK = /^\s*\[\[[^\]\n]+\]\]\s*$/;

export function buildNameMatcher(
  candidates: readonly LinkCandidate[],
  files: readonly NoteFileLike[],
  aliases: Record<string, string> = {},
): NameMatcher {
  const targets = new Set(candidates.map((c) => c.path));
  const fileList = files.filter((f) => !f.isDirectory);
  // A candidate missing from the file list (a just-created note the panel
  // hasn't refreshed yet) still resolves by its own path.
  for (const c of candidates) if (!fileList.some((f) => f.relativePath === c.path)) fileList.push({ relativePath: c.path, isDirectory: false });
  const index = buildWikiLinkIndex(fileList, aliases);
  const byTitle = new Map<string, string[]>();
  for (const c of candidates) {
    const k = c.title.trim().toLowerCase();
    if (!k) continue;
    byTitle.set(k, [...(byTitle.get(k) ?? []), c.path]);
  }

  return (raw: string) => {
    const name = raw.trim();
    if (!name || LINK_UNSAFE.test(name)) return null;
    const resolved = resolveWikiLinkTargetWithIndex(name, index, { pathSlugFallback: false });
    if (resolved && targets.has(resolved)) return `[[${name}]]`;
    const titled = byTitle.get(name.toLowerCase());
    if (titled?.length !== 1) return null;
    const target = canonicalizeWikiLinkTarget(titled[0]!, 'shortest', fileList, aliases);
    if (!target) return null;
    return target === name ? `[[${name}]]` : `[[${target}|${name}]]`;
  };
}

type Outcome = { kind: 'link'; name: string; link: string } | { kind: 'text'; name: string } | { kind: 'linked' };

function classify(value: string, match: NameMatcher): Outcome {
  if (WHOLE_LINK.test(value)) return { kind: 'linked' };
  const link = match(value);
  return link ? { kind: 'link', name: value.trim(), link } : { kind: 'text', name: value.trim() };
}

/**
 * Plan linking `key`'s names in `content`. Null when there is nothing to link —
 * no such key, no name that matches, a value that's already all links, or a
 * shape this doesn't touch (a number, a nested map, unparseable frontmatter).
 *
 * - A string that matches as a whole becomes a single link.
 * - A string that doesn't, but has commas (`Alice, Bob`), is read as a list of
 *   names; if any of them matches, the value becomes a YAML list of the links
 *   and the remaining names, in order.
 * - A YAML list is rewritten item by item, keeping its style; an item that
 *   isn't a plain string is left as it is.
 */
export function planLinkNames(content: string, key: string, match: NameMatcher): LinkNamesPlan | null {
  const parsed = parseFrontmatter(content);
  if (!parsed.ok || 'none' in parsed) return null;
  const doc = YAML.parseDocument(parsed.body);
  if (!YAML.isMap(doc.contents)) return null;
  const node = doc.get(key, true);

  const linked: LinkedName[] = [];
  const unmatched: string[] = [];
  const note = (o: Outcome) => {
    if (o.kind === 'link') linked.push({ name: o.name, link: o.link });
    else if (o.kind === 'text' && o.name) unmatched.push(o.name);
  };

  let write: ((d: YAML.Document) => void) | null = null;

  if (YAML.isScalar(node) && typeof node.value === 'string') {
    const whole = classify(node.value, match);
    if (whole.kind === 'link') {
      note(whole);
      write = (d) => { d.set(key, linkScalar(whole.link)); };
    } else if (whole.kind === 'text' && node.value.includes(',') && !node.value.includes('[[')) {
      // (A string already holding a link isn't split: `[[Smith, Jo]]` has a comma too.)
      const parts = node.value.split(',').map((s) => s.trim()).filter(Boolean).map((s) => classify(s, match));
      parts.forEach(note);
      if (linked.length > 0) {
        write = (d) => {
          const seq = new YAML.YAMLSeq();
          for (const p of parts) seq.add(p.kind === 'link' ? linkScalar(p.link) : new YAML.Scalar(p.kind === 'text' ? p.name : ''));
          // (`parts` never holds a `linked` outcome: a string with `[[` isn't split.)
          d.set(key, seq);
        };
      }
    } else {
      note(whole);
    }
  } else if (YAML.isSeq(node)) {
    const outcomes = node.items.map((item) =>
      YAML.isScalar(item) && typeof item.value === 'string' ? classify(item.value, match) : null);
    outcomes.forEach((o) => { if (o) note(o); });
    if (linked.length > 0) {
      write = (d) => {
        const seq = d.get(key, true);
        if (!YAML.isSeq(seq)) return;
        seq.items.forEach((item, i) => {
          const o = outcomes[i];
          if (o?.kind === 'link' && YAML.isScalar(item)) {
            item.value = o.link;
            item.type = 'QUOTE_DOUBLE';
          }
        });
      };
    }
  }

  if (!write || linked.length === 0) return null;
  const next = applyFrontmatterMutation(content, write);
  if (next === null || next === content) return null;
  return { content: next, linked, unmatched };
}

/** A `[[…]]` value must be quoted — bare, YAML reads it as a nested list. */
function linkScalar(link: string): YAML.Scalar {
  const s = new YAML.Scalar(link);
  s.type = 'QUOTE_DOUBLE';
  return s;
}

/** The confirm's question: what will be linked, and what stays text. */
export function describeLinkPlan(plan: Pick<LinkNamesPlan, 'linked' | 'unmatched'>, what: string): string {
  const list = (xs: string[]) =>
    xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  const linked = plan.linked.map((l) => l.name);
  const rest = plan.unmatched.length === 0
    ? ''
    : ` ${list(plan.unmatched)} ${plan.unmatched.length === 1 ? 'stays' : 'stay'} as text.`;
  return `Link ${list(linked)} to ${linked.length === 1 ? 'its' : 'their'} ${what} ${linked.length === 1 ? 'note' : 'notes'}?${rest}`;
}
