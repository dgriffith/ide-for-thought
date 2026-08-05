/**
 * In-editor broken wiki-link squiggle (#1446 Phase 2). A ViewPlugin that
 * underlines any `[[note]]` whose target doesn't resolve, following the same
 * pattern as `link-decorations.ts` / `highlight-decorations.ts` (scan visible
 * ranges → RangeSetBuilder of Decoration.mark). Detection reuses the shared
 * wiki-link resolver — a link is "broken" exactly when `resolveWikiLinkTarget`
 * finds nothing — so the editor and the graph inspection agree.
 *
 * Scope: note wiki-links only (untyped `[[x]]` and note-kind typed links).
 * `cite::`/`quote::` point at sources/excerpts and are left alone. Anchors are
 * stripped before resolving — a missing heading isn't a missing note.
 */
import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  Decoration,
  type DecorationSet,
  gutter,
  GutterMarker,
} from '@codemirror/view';
import { RangeSetBuilder, StateEffect, type EditorState } from '@codemirror/state';
import { scanLinks, findLinkAt, type LinkRange } from './link-decorations';
import {
  buildWikiLinkIndex,
  resolveWikiLinkTargetWithIndex,
  type WikiLinkIndex,
} from '../../../shared/wiki-link-resolver';
import { getLinkType } from '../../../shared/link-types';

export interface BrokenLinkDeps {
  /** Live list of note relative paths (same source as autocomplete/preview). */
  getNotePaths: () => string[];
  /** Live frontmatter alias entries. */
  getAliases: () => readonly { alias: string; relativePath: string }[];
}

/**
 * Dispatch this effect to force the squiggle to re-resolve against a fresh note
 * set — the note list can change (create / rename / delete elsewhere) without a
 * doc or viewport change, and the quick-fix creating the target must clear the
 * underline. `null` payload; presence is the whole signal.
 */
export const refreshBrokenLinks = StateEffect.define<null>();

/** A wiki link that targets a NOTE (so its resolution is note-existence):
 *  untyped, or a typed link whose `targetKind` is note (undefined). `cite`
 *  (source) / `quote` (excerpt) links resolve differently and are excluded. */
function isNoteWikiLink(link: LinkRange): boolean {
  if (link.kind !== 'wiki') return false;
  if (link.linkType === null) return true;
  return getLinkType(link.linkType).targetKind === undefined;
}

const stripAnchor = (href: string): string => href.split('#')[0] ?? href;

/** A note wiki-link whose target doesn't resolve — the single-link predicate
 *  behind both the squiggle and the Alt-Enter quick-fix. */
export function isBrokenNoteLink(link: LinkRange, index: WikiLinkIndex): boolean {
  if (!isNoteWikiLink(link)) return false;
  const target = stripAnchor(link.href).trim();
  if (!target) return false;
  return resolveWikiLinkTargetWithIndex(target, index) === null;
}

/**
 * Pure core (unit-tested): the note wiki-link ranges in `text` — offset into
 * the doc by `offset` — whose target does not resolve. Empty targets and
 * cite/quote links are skipped.
 */
export function findBrokenWikiRanges(
  text: string,
  offset: number,
  index: WikiLinkIndex,
): LinkRange[] {
  return scanLinks(text, offset).filter((l) => isBrokenNoteLink(l, index));
}

/** Build the resolver index from live deps (note list + aliases), matching how
 *  `linkPreview`/autocomplete adapt the same getters. */
export function buildBrokenLinkIndex(deps: BrokenLinkDeps): WikiLinkIndex {
  const files = deps.getNotePaths().map((relativePath) => ({ relativePath, isDirectory: false }));
  const aliases = Object.fromEntries(deps.getAliases().map((a) => [a.alias.toLowerCase(), a.relativePath]));
  return buildWikiLinkIndex(files, aliases);
}

/** The broken note wiki-link under `pos`, or null. Used by the Alt-Enter
 *  quick-fix to decide whether it has anything to offer. */
export function brokenNoteLinkAt(
  state: EditorState,
  pos: number,
  deps: BrokenLinkDeps,
): LinkRange | null {
  const link = findLinkAt(state, pos);
  if (!link) return null;
  return isBrokenNoteLink(link, buildBrokenLinkIndex(deps)) ? link : null;
}

const brokenMark = Decoration.mark({ class: 'cm-broken-link' });

function buildDecorations(view: EditorView, index: WikiLinkIndex): DecorationSet {
  const all: LinkRange[] = [];
  for (const { from, to } of view.visibleRanges) {
    all.push(...findBrokenWikiRanges(view.state.doc.sliceString(from, to), from, index));
  }
  // RangeSetBuilder requires sorted, non-overlapping ranges. scanLinks yields
  // well-separated wiki matches, but sort + guard defensively.
  all.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const r of all) {
    if (r.from < lastTo) continue;
    builder.add(r.from, r.to, brokenMark);
    lastTo = r.to;
  }
  return builder.finish();
}

/** Subdued warm underline — `--rust` is the theme's established signal color for
 *  "warning/failure" (callouts use it). A broken link is a diagnostic, not a
 *  destructive action, so we avoid alarm-red per the app's UI philosophy. */
const brokenLinkTheme = EditorView.theme({
  '.cm-broken-link': {
    textDecoration: 'underline wavy var(--rust)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '2px',
  },
  // Gutter stripe column, kept snug against the line-number gutter (it's given
  // high precedence below so it renders as the leftmost gutter). No fixed width
  // + tight padding so it's a thin rail, not a floating bar, and it collapses to
  // nothing on clean notes.
  '.cm-broken-gutter': { minWidth: '0' },
  '.cm-broken-gutter .cm-gutterElement': { display: 'flex', justifyContent: 'center', padding: '0 1px' },
  '.cm-broken-line-bar': {
    width: '3px',
    alignSelf: 'stretch',
    background: 'var(--rust)',
    borderRadius: '1px',
  },
});

/** IntelliJ-style gutter stripe: a thin `--rust` bar in its own column on any
 *  line that carries a broken link. Rendered as a GutterMarker (see the theme
 *  block for the bar styling). */
class BrokenLineMarker extends GutterMarker {
  override toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-broken-line-bar';
    el.title = 'Broken link on this line';
    return el;
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof BrokenLineMarker;
  }
}
const brokenLineMarker = new BrokenLineMarker();

export function brokenLinkDecorations(deps: BrokenLinkDeps) {
  const plugin = ViewPlugin.fromClass(
    class {
      index: WikiLinkIndex;
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.index = buildBrokenLinkIndex(deps);
        this.decorations = buildDecorations(view, this.index);
      }
      update(update: ViewUpdate) {
        const forced = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(refreshBrokenLinks)),
        );
        // The note set can change without touching THIS doc (a note created —
        // e.g. by the quick-fix — renamed, or deleted elsewhere). Rebuild the
        // resolver index on an explicit refresh or when the editor regains focus
        // (covers returning to the tab after creating the target); a plain edit
        // to this note doesn't change resolution, so it just re-scans.
        const refocused = update.focusChanged && update.view.hasFocus;
        if (forced || refocused) this.index = buildBrokenLinkIndex(deps);
        if (forced || refocused || update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, this.index);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  // Gutter reads the plugin's live broken-link decorations — no separate scan.
  // The column collapses to nothing when a note has no broken links (no spacer).
  const brokenGutter = gutter({
    class: 'cm-broken-gutter',
    lineMarker(view, line) {
      const inst = view.plugin(plugin);
      if (!inst || inst.decorations.size === 0) return null;
      let has = false;
      inst.decorations.between(line.from, line.to, () => { has = true; return false; });
      return has ? brokenLineMarker : null;
    },
    lineMarkerChange(update) {
      const forced = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(refreshBrokenLinks)),
      );
      return forced || update.docChanged || update.viewportChanged ||
        (update.focusChanged && update.view.hasFocus);
    },
  });

  // NOTE: don't wrap `brokenGutter` in a Prec — CM's `gutter()` bundles the
  // shared gutter renderer, and re-precedencing the whole thing stops it
  // rendering at all. Column order is set by registration order instead: this
  // is registered ahead of the bookmark gutter in Editor.svelte so it sits in
  // the left gutter group, not out by the text.
  return [plugin, brokenLinkTheme, brokenGutter];
}
