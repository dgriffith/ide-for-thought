/**
 * Link-hover previews in published HTML (#2710, part 2): the static site (and
 * so git / S3 publishing) and the tree HTML bundle.
 *
 * A link in the app shows the linked note's title and a snippet of its opening,
 * or of the `#heading` / `^block` it names (`NoteHoverPreview`, #2713). A
 * published page shows the same text: it is computed here, at export time, by
 * the same `buildNotePreview` the app's hover fetcher calls (minus hidden
 * fences, which no export publishes), and shipped as ONE
 * data file per site, `previews.js`, keyed by page. The page script
 * (`link-preview-script.ts`, `preview.js`) loads it on the first hover or
 * focus and looks a link up by where its `href` lands — so prose wiki-links,
 * backlinks, and the static views' linked items (Kanban cards, timeline events,
 * the map's fallback list) all get it without any per-link markup.
 *
 * **The security rule: a preview exists only for a note that is itself
 * published.** `buildLinkPreviews` is handed the published note set and
 * nothing else — a note the pipeline excluded (`exclusion.ts`), the site
 * config filtered, or that doesn't exist has no entry, so its text can't reach
 * the data file. A link to one has no `href` to look up in the first place
 * (`noteHref` links only to exported notes). Under `inline-title` / `drop`
 * links are plain text, so there is nothing to preview and no file is written.
 *
 * Why a `.js` data file rather than `previews.json`: `search.json` is
 * `fetch`ed, and Chromium refuses `fetch` on `file://`, so a site opened from
 * disk (or a tree bundle, which is usually opened from disk) would lose its
 * previews. A `<script src>` loads from `file://` and from any static host.
 * The script assigns a JSON literal; nothing in it is evaluated as code.
 */
import { buildNotePreview, type NotePreviewSection } from '../../shared/note-preview';
import { slugify } from '../../shared/slug';
import { stripHiddenFences } from '../../shared/markdown/fence-info';
import type { ExportPlanFile } from './types';

/** One preview: `t` the title, `s` the snippet (short keys — this ships per site). */
export interface LinkPreviewEntry { t: string; s: string }

/** Page URL (site-root-relative, decoded; `#fragment` for a section) → preview. */
export type LinkPreviewMap = Record<string, LinkPreviewEntry>;

/** The data file's name, at the site / bundle root. */
export const LINK_PREVIEWS_FILE = 'previews.js';
/** The page script's name, at the site / bundle root. */
export const LINK_PREVIEW_SCRIPT_FILE = 'preview.js';
/** The global `previews.js` assigns. */
export const LINK_PREVIEWS_GLOBAL = '__minervaLinkPreviews';

export interface BuildLinkPreviewsInput {
  /** The notes this export publishes — after every exclusion. The ONLY source of preview text. */
  published: ExportPlanFile[];
  /** The page a note is published at, site-root-relative (`a/b.md` → `a/b.html`). */
  pageFor: (relativePath: string) => string;
  /** The note a wiki-link target names, as the export resolves it (`LinkResolverContext.resolveTarget`). */
  resolveTarget: (target: string) => string | null;
}

/**
 * Every published note's preview, keyed by its page, plus one entry per
 * `[[note#Heading]]` / `[[note#^block]]` a published note links to, keyed by
 * the page and the fragment the exported link carries (the wiki-link rule's
 * `slugify(heading)` / `^block`).
 */
export function buildLinkPreviews(input: BuildLinkPreviewsInput): LinkPreviewMap {
  const byPath = new Map<string, ExportPlanFile>();
  for (const n of input.published) if (n.kind === 'note') byPath.set(n.relativePath, n);
  const out: LinkPreviewMap = Object.create(null) as LinkPreviewMap;
  for (const [p, note] of byPath) out[input.pageFor(p)] = toEntry(note, {});
  for (const note of byPath.values()) {
    for (const link of sectionLinks(note.content)) {
      const resolved = input.resolveTarget(link.target);
      const target = resolved ? byPath.get(resolved) : undefined;
      if (!target) continue; // not published (or nothing): no preview, and its text is never read
      const key = `${input.pageFor(target.relativePath)}#${link.fragment}`;
      if (!(key in out)) out[key] = toEntry(target, link.section);
    }
  }
  return out;
}

/**
 * A note's preview as the app builds it, from its text minus its hidden
 * fences: machine-facing content the published page itself never shows
 * (#2509) mustn't reach a reader through the preview either. A note with none
 * — nearly every note — gets exactly the app's preview.
 */
function toEntry(note: ExportPlanFile, section: NotePreviewSection): LinkPreviewEntry {
  const p = buildNotePreview(stripHiddenFences(note.content), note.relativePath, section);
  return { t: p.title, s: p.snippet };
}

interface SectionLink { target: string; fragment: string; section: NotePreviewSection }

/** `[[target#anchor]]` links (typed or not, with or without `|display`), as the wiki-link rule splits them. */
function sectionLinks(content: string): SectionLink[] {
  const out: SectionLink[] = [];
  for (const m of content.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
    const inner = m[1]!;
    if (/^(cite|quote)::/i.test(inner)) continue;
    const pipe = inner.indexOf('|');
    const untyped = (pipe >= 0 ? inner.slice(0, pipe) : inner).replace(/^[a-z][a-z0-9_]*::/i, '').trim();
    const hash = untyped.indexOf('#');
    if (hash < 0) continue;
    const target = untyped.slice(0, hash).trim();
    const anchor = untyped.slice(hash + 1).trim();
    if (!target || !anchor) continue;
    if (anchor.startsWith('^')) {
      out.push({ target, fragment: anchor, section: { blockId: anchor.slice(1).trim() } });
    } else {
      out.push({ target, fragment: slugify(anchor), section: { heading: anchor } });
    }
  }
  return out;
}

/**
 * The `previews.js` data file: one assignment of a JSON literal. `<`, U+2028
 * and U+2029 are escaped as well, so the literal stays inert even if someone
 * pastes it into an inline `<script>`.
 */
export function linkPreviewsScript(map: LinkPreviewMap): string {
  const json = JSON.stringify(map)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `window.${LINK_PREVIEWS_GLOBAL}=${json};\n`;
}
