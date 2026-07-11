/**
 * CodeMirror hover tooltip that previews a `[[wiki-link]]`'s target note when
 * the user hovers it in the editor (#1131). Mirrors `footnote-preview.ts`; the
 * one new muscle is async content — a link's target lives in ANOTHER file, so
 * the tooltip returns a placeholder synchronously and fills it once the cached
 * read resolves.
 *
 * Only plain note links preview here. Typed links (`cite::`, `quote::`) are out
 * of scope (a richer source/excerpt card is a follow-on, #1071).
 */
import type { Extension } from '@codemirror/state';
import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { parseWikiInner } from './link-decorations';
import { makeNotePreviewFetcher, type NotePreviewDeps } from './note-preview';

// Local copy (fresh lastIndex per scan; never shared) — matches the WIKI_RE in
// link-decorations.ts.
const WIKI_RE = /\[\[([^[\]\n]+)\]\]/g;

export function linkPreview(deps: NotePreviewDeps): Extension {
  const fetchPreview = makeNotePreviewFetcher(deps);

  return hoverTooltip((view, pos): Tooltip | null => {
    const line = view.state.doc.lineAt(pos);
    const text = line.text;
    const col = pos - line.from;

    // Find a `[[…]]` span that contains the hover position.
    WIKI_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let hit: { start: number; end: number; inner: string } | null = null;
    while ((m = WIKI_RE.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (col >= start && col <= end) {
        hit = { start, end, inner: m[1]! };
        break;
      }
    }
    if (!hit) return null;

    const { target, linkType } = parseWikiInner(hit.inner);
    // Skip typed links (cite::/quote::…) and empty targets — plain notes only.
    if (linkType || !target) return null;

    return {
      pos: line.from + hit.start,
      end: line.from + hit.end,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-link-preview loading';
        dom.textContent = '…';
        void fetchPreview(target).then((preview) => {
          if (!preview) {
            dom.className = 'cm-link-preview missing';
            dom.textContent = `“${target}” not found`;
            return;
          }
          dom.className = 'cm-link-preview';
          dom.textContent = '';
          const titleEl = document.createElement('div');
          titleEl.className = 'title';
          titleEl.textContent = preview.title;
          const body = document.createElement('div');
          body.className = 'body';
          body.textContent = preview.snippet || '(empty note)';
          dom.append(titleEl, body);
        }).catch(() => {
          dom.className = 'cm-link-preview missing';
          dom.textContent = `“${target}” not found`;
        });
        return { dom };
      },
    };
  }, {
    // Match the footnote-preview feel — short delay, no hideOnChange.
    hoverTime: 250,
  });
}
