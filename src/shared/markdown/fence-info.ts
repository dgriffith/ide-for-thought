/**
 * Fence info-string convention for hidden fences (#2039). A fence language
 * suffixed `-hidden` (e.g. `` ```turtle-hidden ``) marks machine-facing
 * content — graph-real, but not meant for a human reader — that shouldn't
 * clutter the preview or the editor: it renders nothing in preview and
 * starts folded in the editor. "Hidden" is purely presentational; it must
 * NOT affect indexing/extraction, which still keys on `lang`.
 *
 * Single source of truth for the suffix, consumed by the main-process
 * Turtle-block extractor (`graph/parser.ts`), the preview fence plugin
 * (`markdown/fence-plugin.ts`), and the editor's hidden-fence fold-range
 * scanner (`editor/hidden-fences.ts`) — so the three can't drift apart on
 * what "hidden" means.
 */

export const HIDDEN_FENCE_SUFFIX = '-hidden';

export interface FenceInfo {
  /** The fence language with any `-hidden` suffix stripped, lowercased. */
  lang: string;
  hidden: boolean;
}

/** Parse a raw fence info string (e.g. `tok.info`, or the text right after
 *  the opening backticks). Trims and lowercases, matching how every existing
 *  fence consumer in this codebase already normalizes it. */
export function parseFenceInfo(rawInfo: string): FenceInfo {
  const info = rawInfo.trim().toLowerCase();
  if (info.length > HIDDEN_FENCE_SUFFIX.length && info.endsWith(HIDDEN_FENCE_SUFFIX)) {
    return { lang: info.slice(0, -HIDDEN_FENCE_SUFFIX.length), hidden: true };
  }
  return { lang: info, hidden: false };
}

/**
 * Remove every hidden fence (opening line through closing line) from markdown
 * source (#2509), for exports meant for readers outside Minerva. A line scanner,
 * not a regex: it tracks every fence it's inside, so a hidden-looking fence
 * quoted INSIDE another code block is left alone, and a fence closes only on
 * the same character, at least as long as it opened (CommonMark). An unclosed
 * hidden fence runs to the end of the document, as CommonMark renders it.
 */
export function stripHiddenFences(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let open: { char: string; len: number; hidden: boolean } | null = null;
  // Set after a hidden fence closes: one blank line after it is dropped when
  // the line before it was blank too, so removing a fence doesn't leave a
  // double gap. Nothing else's spacing is touched.
  let afterRemoved = false;
  for (const line of lines) {
    if (afterRemoved) {
      afterRemoved = false;
      if (line.trim() === '' && (out.length === 0 || out[out.length - 1]!.trim() === '')) continue;
    }
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      if (m && m[1]![0] === open.char && m[1]!.length >= open.len && m[2]!.trim() === '') {
        if (!open.hidden) out.push(line);
        else afterRemoved = true;
        open = null;
        continue;
      }
      if (!open.hidden) out.push(line);
      continue;
    }
    if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
      open = { char: m[1]![0]!, len: m[1]!.length, hidden: parseFenceInfo(m[2]!).hidden };
      if (!open.hidden) out.push(line);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
