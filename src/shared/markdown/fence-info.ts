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
