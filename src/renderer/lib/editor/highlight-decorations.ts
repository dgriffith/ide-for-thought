/**
 * Source-mode rendering for `==text==` / `==color:text==` (#468).
 *
 * The preview already lights up these spans via the markdown-it
 * plugin; this extension paints the same tint in the editor itself so
 * the highlight is visible while typing. We don't hide the `==`
 * delimiters — keeping them visible is the convention for inline
 * markup (matches the `*…*` and `~~…~~` story); the user can see
 * exactly what they wrote.
 *
 * Scanner is shared with the preview plugin (`scanHighlights`) so the
 * two surfaces agree on which substrings count as highlights.
 */

import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  Decoration,
  type DecorationSet,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { scanHighlights } from '../../../shared/markdown/highlight-plugin';

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    const matches = scanHighlights(text, from);
    // RangeSetBuilder demands sorted, non-overlapping ranges. The
    // scanner already returns them in left-to-right order with no
    // overlap (it advances past each closing `==`).
    for (const m of matches) {
      builder.add(
        m.from,
        m.to,
        Decoration.mark({
          class: m.color ? `cm-highlight cm-highlight-${m.color}` : 'cm-highlight',
          attributes: m.color ? { 'data-hl-color': m.color } : undefined,
        }),
      );
    }
  }
  return builder.finish();
}

const highlightTheme = EditorView.theme({
  // Base colors live in global.css so theme swaps (Honey / Light /
  // Contrast) flow through. The tint percentages match the preview's
  // `mark.hl-*` rules so the two surfaces look the same intensity.
  '.cm-highlight': {
    background: 'color-mix(in oklch, var(--accent) 22%, transparent)',
    borderRadius: '2px',
  },
  '.cm-highlight-yellow': { background: 'color-mix(in oklch, var(--hl-yellow) 30%, transparent)' },
  '.cm-highlight-green':  { background: 'color-mix(in oklch, var(--hl-green) 30%, transparent)' },
  '.cm-highlight-blue':   { background: 'color-mix(in oklch, var(--hl-blue) 30%, transparent)' },
  '.cm-highlight-pink':   { background: 'color-mix(in oklch, var(--hl-pink) 30%, transparent)' },
  '.cm-highlight-orange': { background: 'color-mix(in oklch, var(--hl-orange) 30%, transparent)' },
});

export function highlightDecorations() {
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
    { decorations: (v) => v.decorations },
  );
  return [plugin, highlightTheme];
}
