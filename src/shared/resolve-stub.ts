/**
 * Wire shape shared between the renderer (resolve picker) and the
 * main process (CrossRef search + apply). (#107)
 */
export interface ResolveCandidate {
  doi: string;
  title: string;
  authors: string[];
  year: string | null;
  containerTitle: string | null;
  /** Normalised 0–1 confidence used to size the bar + decide
   *  whether to auto-apply without showing the picker. */
  confidence: number;
  /** Plain-text breakdown ("title match", "year match", "1 author
   *  in common", …). Surfaced as a tooltip / line under the title. */
  reasoning: string;
}

/** Default threshold for auto-applying the top candidate without
 *  showing the picker. Surfaced as a constant so the renderer can
 *  paint a "Auto-applied" indicator using the same number. */
export const RESOLVE_AUTO_THRESHOLD = 0.85;
