/**
 * CodeMirror hover tooltip that previews a footnote definition when
 * the user hovers over a `[^name]` reference in the editor (#484).
 *
 * Behavior:
 *   - Hover over `[^foo]` → tooltip shows the definition body for
 *     `[^foo]: …`, with continuation lines joined.
 *   - Hover over a reference whose label has no definition → quiet
 *     "No definition for `[^foo]`" tooltip, italic + muted.
 *   - Hover over a definition opener `[^foo]:` → shows nothing
 *     (the body is already on screen).
 *
 * Definitions are scanned from the current editor buffer on each
 * tooltip request — that's O(n) over the file but the call rate is
 * gated by CodeMirror's hover delay, so re-scanning on demand stays
 * cheaper than maintaining a reactive index.
 */

import type { Extension } from '@codemirror/state';
import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { scanFootnotes } from '../footnotes';

const REF_RE = /(?<!\\)\[\^([\w-]+)\](?!:)/g;

export function footnotePreview(): Extension {
  return hoverTooltip((view, pos): Tooltip | null => {
    const line = view.state.doc.lineAt(pos);
    const text = line.text;
    const col = pos - line.from;

    // Skip definition openers — the body is already visible inline.
    if (/^\[\^[\w-]+\]:/.test(text)) return null;

    // Find a `[^name]` span that contains the hover position.
    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let hit: { start: number; end: number; label: string } | null = null;
    while ((m = REF_RE.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (col >= start && col <= end) {
        hit = { start, end, label: m[1] };
        break;
      }
    }
    if (!hit) return null;

    const scan = scanFootnotes(view.state.doc.toString());
    const def = scan.definitions.find((d) => d.label === hit.label);

    return {
      pos: line.from + hit.start,
      end: line.from + hit.end,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-footnote-tooltip';
        if (def) {
          const label = document.createElement('div');
          label.className = 'label';
          label.textContent = `[^${hit.label}]`;
          const body = document.createElement('div');
          body.className = 'body';
          body.textContent = def.body || '(empty definition)';
          dom.appendChild(label);
          dom.appendChild(body);
        } else {
          dom.classList.add('missing');
          dom.textContent = `No definition for [^${hit.label}]`;
        }
        return { dom };
      },
    };
  }, {
    // Match the rest of the app's hover feel — short delay, no
    // hideOnChange so the tooltip survives a stray mouse twitch.
    hoverTime: 250,
  });
}
