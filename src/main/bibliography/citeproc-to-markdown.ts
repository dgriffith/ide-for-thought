/**
 * Convert a citeproc-js bibliography entry (HTML) to markdown (#113).
 *
 * citeproc emits each entry as `<div class="csl-entry">…</div>`. Inside,
 * the only formatting tags it actually uses are `<i>` (titles) and `<b>`
 * (rare — author/year emphasis in some styles), plus the occasional
 * `<span style="font-variant: small-caps">…</span>` we don't try to
 * preserve.
 *
 * For markdown we map `<i>` → `*…*` and `<b>` → `**…**`, drop other
 * tags keeping inner text, and decode the entities citeproc emits
 * (`&amp;`, `&#x27;`, named and numeric).
 */

const ENTITY_NAMES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (_, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return ENTITY_NAMES[body] ?? '';
  });
}

/** Drop the outer `<div class="csl-entry">…</div>` if present. */
function stripCslEntryWrapper(html: string): string {
  const trimmed = html.trim();
  const open = trimmed.match(/^<div\b[^>]*class="[^"]*csl-entry[^"]*"[^>]*>/i);
  if (!open) return trimmed;
  if (!trimmed.endsWith('</div>')) return trimmed;
  return trimmed.slice(open[0].length, -'</div>'.length).trim();
}

export function citeprocEntryToMarkdown(html: string): string {
  let out = stripCslEntryWrapper(html);
  // Convert italic / bold first — order matters because we're going to
  // strip remaining tags after this and would lose the formatting.
  out = out.replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, (_, inner: string) => `*${inner.trim()}*`);
  out = out.replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, (_, inner: string) => `**${inner.trim()}**`);
  // Strip every remaining tag, keeping inner text.
  out = out.replace(/<[^>]+>/g, '');
  out = decodeEntities(out);
  // Collapse whitespace runs that came from the citeproc HTML formatting.
  out = out.replace(/[\t ]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  return out;
}
