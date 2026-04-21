import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  Decoration,
  type DecorationSet,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';

export type LinkKind = 'wiki' | 'markdown' | 'url';

export interface LinkRange {
  from: number;
  to: number;
  kind: LinkKind;
  /** Where the link points — note path for wiki, URL otherwise. */
  href: string;
  /**
   * Wiki-link type prefix (`cite`, `quote`, `supports`, …) or null for
   * the default untyped `[[target]]` form. Ignored for markdown and URL.
   */
  linkType: string | null;
  /**
   * Range of the "editable target" inside the link, used by Edit Link.
   * For wiki: the bare target (after `type::`, before `|`).
   * For markdown: the URL inside `(...)`.
   * For bare URL: the whole URL.
   */
  editFrom: number;
  editTo: number;
}

interface LinkOptions {
  onOpenNote: (target: string) => void;
  /** Click on a `[[cite::source-id]]` link → open the source tab. */
  onOpenSource?: (sourceId: string) => void;
  /** Click on a `[[quote::excerpt-id]]` link → open the source tab scrolled to the excerpt. */
  onOpenExcerpt?: (excerptId: string) => void;
  onOpenExternal: (url: string) => void;
}

// [[target]] | [[target|display]] | [[type::target]] | [[type::target|display]]
// The inner cannot contain `[` or `]` to keep the match well-defined.
const WIKI_RE = /\[\[([^\[\]\n]+)\]\]/g;
// [text](url) — text can't contain `]` or newline, url can't contain `)`, whitespace, or newline.
const MARKDOWN_LINK_RE = /\[([^\]\n]+)\]\(([^)\s\n]+)\)/g;
// Bare http(s) URL. Cut off common trailing punctuation ("See https://foo." → don't include the period).
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>()\[\]{}"'`]+/g;

/** Exposed for tests. */
export function parseWikiInner(inner: string): {
  target: string;
  targetStart: number;
  targetEnd: number;
  linkType: string | null;
} {
  // inner is the content between [[ and ]]
  const pipe = inner.indexOf('|');
  const beforePipe = pipe >= 0 ? inner.slice(0, pipe) : inner;
  const typeSep = beforePipe.indexOf('::');
  const targetStart = typeSep >= 0 ? typeSep + 2 : 0;
  const targetEnd = pipe >= 0 ? pipe : inner.length;
  const linkType = typeSep >= 0 ? beforePipe.slice(0, typeSep).trim() : null;
  return {
    target: inner.slice(targetStart, targetEnd).trim(),
    targetStart,
    targetEnd,
    linkType: linkType && /^[a-z][\w-]*$/.test(linkType) ? linkType : null,
  };
}

/** Strip trailing punctuation that a user almost never means as part of the URL. */
function trimUrlTail(url: string): string {
  return url.replace(/[.,;:!?)\]}'"]+$/, '');
}

function scanLinks(text: string, offset: number): LinkRange[] {
  const ranges: LinkRange[] = [];

  // Markdown links first — they need to shadow any bare URL that lives inside.
  for (const m of text.matchAll(MARKDOWN_LINK_RE)) {
    const matchFrom = offset + (m.index ?? 0);
    const matchTo = matchFrom + m[0].length;
    // Positions of the URL inside the match: after `](`
    const urlOpenIdx = m[0].indexOf('](') + 2;
    const urlStart = matchFrom + urlOpenIdx;
    const urlEnd = urlStart + m[2].length;
    ranges.push({
      from: matchFrom,
      to: matchTo,
      kind: 'markdown',
      href: m[2],
      linkType: null,
      editFrom: urlStart,
      editTo: urlEnd,
    });
  }

  for (const m of text.matchAll(WIKI_RE)) {
    const matchFrom = offset + (m.index ?? 0);
    const matchTo = matchFrom + m[0].length;
    const inner = m[1];
    const parsed = parseWikiInner(inner);
    ranges.push({
      from: matchFrom,
      to: matchTo,
      kind: 'wiki',
      href: parsed.target,
      linkType: parsed.linkType,
      editFrom: matchFrom + 2 + parsed.targetStart, // +2 for `[[`
      editTo: matchFrom + 2 + parsed.targetEnd,
    });
  }

  for (const m of text.matchAll(BARE_URL_RE)) {
    const rawFrom = offset + (m.index ?? 0);
    const trimmed = trimUrlTail(m[0]);
    const rawTo = rawFrom + trimmed.length;
    // Skip if inside a markdown link we already captured.
    if (ranges.some(r => r.kind === 'markdown' && r.from <= rawFrom && r.to >= rawTo)) continue;
    ranges.push({
      from: rawFrom,
      to: rawTo,
      kind: 'url',
      href: trimmed,
      linkType: null,
      editFrom: rawFrom,
      editTo: rawTo,
    });
  }

  return ranges;
}

/**
 * Scan the line at `pos` for any link whose range contains `pos`.
 * Used by the editor context menu to decide whether to show "Edit Link".
 */
export function findLinkAt(state: EditorState, pos: number): LinkRange | null {
  const line = state.doc.lineAt(pos);
  const ranges = scanLinks(line.text, line.from);
  return ranges.find(r => pos >= r.from && pos <= r.to) ?? null;
}

function buildDecorations(view: EditorView): DecorationSet {
  const all: LinkRange[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    all.push(...scanLinks(text, from));
  }
  // RangeSetBuilder requires non-overlapping ranges sorted by `from`.
  all.sort((a, b) => a.from - b.from || a.to - b.to);
  const nonOverlapping: LinkRange[] = [];
  for (const r of all) {
    const last = nonOverlapping[nonOverlapping.length - 1];
    if (!last || last.to <= r.from) nonOverlapping.push(r);
  }

  const builder = new RangeSetBuilder<Decoration>();
  for (const r of nonOverlapping) {
    builder.add(
      r.from,
      r.to,
      Decoration.mark({
        class: 'cm-clickable-link',
        attributes: {
          'data-link-kind': r.kind,
          'data-link-href': r.href,
          ...(r.linkType ? { 'data-link-type': r.linkType } : {}),
        },
      }),
    );
  }
  return builder.finish();
}

const linkTheme = EditorView.theme({
  '.cm-clickable-link': {
    color: 'var(--accent)',
    textDecoration: 'underline',
    textDecorationColor: 'color-mix(in srgb, var(--accent) 50%, transparent)',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },
  '.cm-clickable-link:hover': {
    textDecorationColor: 'var(--accent)',
  },
});

export function linkDecorations(opts: LinkOptions) {
  function hasModifier(e: MouseEvent): boolean {
    return e.metaKey || e.ctrlKey;
  }

  function linkElFromEvent(e: MouseEvent): HTMLElement | null {
    const target = e.target as HTMLElement | null;
    if (!target) return null;
    return target.closest('.cm-clickable-link') as HTMLElement | null;
  }

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: v => v.decorations,
      eventHandlers: {
        // Plain click: prevent caret from landing inside the link (we'll
        //   treat it as a single-unit navigation in the click handler).
        // ⌘/Ctrl-click: place a single caret at the click position so the
        //   user can edit the link text. Without intercepting, CM6's default
        //   would ADD a cursor (multi-cursor feature), leaving a phantom
        //   caret at the prior selection that echoes every keystroke.
        mousedown(event: MouseEvent, view: EditorView) {
          if (event.button !== 0) return false;
          const el = linkElFromEvent(event);
          if (!el) return false;
          if (hasModifier(event)) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos !== null) {
              view.dispatch({ selection: { anchor: pos } });
            }
          }
          event.preventDefault();
          return true;
        },
        click(event: MouseEvent) {
          if (event.button !== 0) return false;
          // ⌘/Ctrl-click is the edit gesture; caret was placed in mousedown,
          // and the click handler must not also open the link.
          if (hasModifier(event)) return false;
          const el = linkElFromEvent(event);
          if (!el) return false;
          const kind = el.getAttribute('data-link-kind') as LinkKind | null;
          const href = el.getAttribute('data-link-href');
          const linkType = el.getAttribute('data-link-type');
          if (!kind || !href) return false;
          event.preventDefault();
          if (kind === 'wiki') {
            // Typed `cite::` / `quote::` links target sources and excerpts,
            // not notes. Fall back to note-navigation for anything else —
            // that preserves the original behaviour for supports/rebuts/etc.
            if (linkType === 'cite' && opts.onOpenSource) {
              opts.onOpenSource(href);
            } else if (linkType === 'quote' && opts.onOpenExcerpt) {
              opts.onOpenExcerpt(href);
            } else {
              opts.onOpenNote(href);
            }
          } else {
            opts.onOpenExternal(href);
          }
          return true;
        },
      },
    },
  );

  return [plugin, linkTheme];
}
