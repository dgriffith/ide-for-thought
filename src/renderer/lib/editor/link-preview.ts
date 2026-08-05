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

const LIGHTBULB =
  `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 13h4M6.5 15h3"/><path d="M8 1a5 5 0 0 0-3 9c.5.4.8 1 .8 1.6h4.4c0-.6.3-1.2.8-1.6A5 5 0 0 0 8 1z"/></svg>`;

/** Deps for the hover preview + its broken-link quick-fix (#1446). */
export type LinkPreviewDeps = NotePreviewDeps & {
  /** When a hovered link's target is missing, the tooltip offers a "Create Note
   *  From Reference" lightbulb that calls this (the same fix as Alt-Enter). */
  onCreateNoteFromReference?: (target: string) => void;
};

export function linkPreview(deps: LinkPreviewDeps): Extension {
  const fetchPreview = makeNotePreviewFetcher(deps);

  /** Render the "not found" state, plus a lightbulb quick-fix when wired. This
   *  is the in-editor hover affordance for a broken link (#1446) — one tooltip,
   *  so it doesn't collide with the squiggle's own hover. */
  function showMissing(dom: HTMLElement, target: string): void {
    dom.className = 'cm-link-preview missing';
    dom.textContent = '';
    const msg = document.createElement('div');
    msg.className = 'missing-msg';
    msg.textContent = `“${target}” not found`;
    dom.append(msg);
    if (deps.onCreateNoteFromReference) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cm-link-fix';
      btn.innerHTML = `${LIGHTBULB}<span>Create Note From Reference</span>`;
      btn.onmousedown = (e) => { e.preventDefault(); }; // keep editor focus
      btn.onclick = () => deps.onCreateNoteFromReference!(target);
      dom.append(btn);
    }
  }

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
            showMissing(dom, target);
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
          showMissing(dom, target);
        });
        return { dom };
      },
    };
  }, {
    // Match the footnote-preview feel — short delay, no hideOnChange.
    hoverTime: 250,
  });
}
