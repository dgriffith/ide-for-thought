/**
 * A plugin's description is Markdown, and may run to several sections (a
 * "Security" one, say) — Settings → Plugins renders all of it
 * (`renderer/lib/plugins/plugin-description.ts`). A native dialog can't
 * render Markdown and shouldn't carry the whole thing: it gets the summary,
 * the description's first paragraph as plain text.
 */

/** The first paragraph of `markdown` (up to a blank line or a heading), its inline syntax removed. */
export function descriptionSummary(markdown: string): string {
  const lines: string[] = [];
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim();
    if (t === '') { if (lines.length > 0) break; continue; }
    if (/^#{1,6}\s/.test(t)) { if (lines.length > 0) break; continue; }
    lines.push(t);
  }
  return lines.join(' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])([*_])(?=\S)(.+?)(?<=\S)\2(?!\w)/g, '$1$3')
    .replace(/\s+/g, ' ')
    .trim();
}
