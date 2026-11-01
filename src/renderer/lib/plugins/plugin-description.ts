/**
 * A plugin's description, as Markdown, for Settings → Plugins' detail pane.
 *
 * Someone else wrote it: an installed plugin's `plugin.json` is third-party
 * text. So markdown-it runs with `html: false` (raw HTML is escaped, not
 * rendered), images are off (a description has no business fetching
 * anything), and the result still goes through the note sanitizer before it
 * reaches `{@html}`. Links render, and the pane opens them with
 * `api.shell.openExternal`, which only opens http(s).
 */
import MarkdownIt from 'markdown-it';
import { sanitizeNoteHtml } from '../preview/sanitize-note-html';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });
md.disable('image');

export function renderPluginDescription(src: string): string {
  return sanitizeNoteHtml(md.render(src));
}
