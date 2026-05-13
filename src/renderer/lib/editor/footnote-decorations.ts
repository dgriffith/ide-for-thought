import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  Decoration,
  type DecorationSet,
} from '@codemirror/view';
import { RangeSetBuilder, type EditorState } from '@codemirror/state';
import { scanFootnotes } from '../footnotes';

/**
 * Clickable footnote decorations + jump-on-click navigation.
 *
 * Mirrors `link-decorations.ts`'s pattern: scan for `[^id]` references
 * (inline) and `[^id]:` definitions (at line start), decorate both as
 * clickable, and on plain click jump to the matching counterpart.
 * ⌘/Ctrl-click breaks through to caret placement so the user can edit
 * the footnote text. Same convention as wiki-links.
 *
 * Refs and defs are matched by label, not position — multiple refs to
 * the same label all jump to the same def; clicking a def jumps to the
 * first ref. Code fences and inline-code spans are skipped (the
 * shared `scanFootnotes` helper handles both for us).
 */

interface Mark {
  from: number;
  to: number;
  label: string;
  kind: 'ref' | 'def';
}

function scanMarks(state: EditorState): Mark[] {
  const text = state.doc.toString();
  const scan = scanFootnotes(text);
  const out: Mark[] = [];

  for (const def of scan.definitions) {
    const line = state.doc.line(def.defLine);
    const from = line.from + def.defColumn;
    // Decorate just the `[^label]` opener — not the `:` or the body.
    const opener = `[^${def.label}]`;
    out.push({
      from,
      to: from + opener.length,
      label: def.label,
      kind: 'def',
    });
  }

  for (const ref of scan.references) {
    const line = state.doc.line(ref.line);
    const from = line.from + ref.column;
    const text = `[^${ref.label}]`;
    out.push({
      from,
      to: from + text.length,
      label: ref.label,
      kind: 'ref',
    });
  }

  return out;
}

function buildDecorations(state: EditorState): DecorationSet {
  const marks = scanMarks(state);
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const m of marks) {
    builder.add(
      m.from,
      m.to,
      Decoration.mark({
        class: 'cm-clickable-footnote',
        attributes: {
          'data-footnote-id': m.label,
          'data-footnote-kind': m.kind,
        },
      }),
    );
  }
  return builder.finish();
}

const footnoteTheme = EditorView.theme({
  '.cm-clickable-footnote': {
    color: 'var(--accent)',
    textDecoration: 'underline',
    textDecorationColor: 'color-mix(in srgb, var(--accent) 50%, transparent)',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },
  '.cm-clickable-footnote:hover': {
    textDecorationColor: 'var(--accent)',
  },
});

export function footnoteDecorations() {
  function markElFromEvent(e: MouseEvent): HTMLElement | null {
    const target = e.target as HTMLElement | null;
    return target?.closest('.cm-clickable-footnote') ?? null;
  }

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view.state);
      }
      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildDecorations(update.state);
        }
      }
    },
    {
      decorations: v => v.decorations,
      eventHandlers: {
        // ⌘/Ctrl-click: place caret at click position so the user can
        // edit the footnote text. Plain click is the navigation gesture
        // (handled in `click`). Without this guard CM6's default
        // mousedown would still place a caret, then the click handler
        // below would jump — visually the cursor would briefly land in
        // the wrong spot before flying away.
        mousedown(event: MouseEvent, view: EditorView) {
          if (event.button !== 0) return false;
          const el = markElFromEvent(event);
          if (!el) return false;
          if (event.metaKey || event.ctrlKey) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos !== null) view.dispatch({ selection: { anchor: pos } });
          }
          event.preventDefault();
          return true;
        },
        click(event: MouseEvent, view: EditorView) {
          if (event.button !== 0) return false;
          if (event.metaKey || event.ctrlKey) return false;
          const el = markElFromEvent(event);
          if (!el) return false;
          const id = el.getAttribute('data-footnote-id');
          const kind = el.getAttribute('data-footnote-kind') as 'ref' | 'def' | null;
          if (!id || !kind) return false;
          // Find the counterpart. Re-scan rather than memoize — clicks
          // are infrequent and the doc may have changed since the last
          // decoration build.
          const all = scanMarks(view.state);
          const wanted = kind === 'ref' ? 'def' : 'ref';
          const target = all.find((m) => m.kind === wanted && m.label === id);
          if (!target) return false;
          view.dispatch({
            selection: { anchor: target.from },
            scrollIntoView: true,
          });
          view.focus();
          event.preventDefault();
          return true;
        },
      },
    },
  );

  return [plugin, footnoteTheme];
}
