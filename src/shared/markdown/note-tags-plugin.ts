/**
 * `#tag` in note text (#2526): one rule for which text is a tag, shared by the
 * preview and every export, so an export recognises exactly the tags the
 * preview shows. Only the rendering differs: the preview's chip, a static
 * site's link to its tag page, a single-file export's static chip.
 */
import type { MarkdownIt } from 'markdown-it';
import { escapeAttr, escapeHtml } from '../text-escape';

/** The preview's tag chip — the default rendering. */
export function noteTagChipHtml(tag: string): string {
  return `<span class="note-tag" data-tag="${escapeAttr(tag)}">#${escapeHtml(tag)}</span>`;
}

export function installNoteTags(md: MarkdownIt, render: (tag: string) => string = noteTagChipHtml): void {
  md.inline.ruler.push('note_tag', (state, silent) => {
    // Must be at start or preceded by whitespace.
    if (state.pos > 0 && state.src[state.pos - 1] !== ' ' && state.src[state.pos - 1] !== '\n') return false;
    const src = state.src.slice(state.pos);
    const match = src.match(/^#([a-zA-Z][\w-/]*)/);
    if (!match) return false;
    if (!silent) {
      const token = state.push('note_tag', '', 0);
      token.meta = { tag: match[1] };
    }
    state.pos += match[0].length;
    return true;
  });

  md.renderer.rules.note_tag = (tokens, idx) => render((tokens[idx]!.meta as { tag: string }).tag);
}

/**
 * The file a static site writes a tag's page to, and every link to it uses —
 * one function, so a hierarchical `#trip/prague` can't be written to
 * `trip-prague.html` and linked as `trip%2Fprague.html` (it was).
 */
export function tagPageFilename(tag: string): string {
  return `${tag.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'tag'}.html`;
}
