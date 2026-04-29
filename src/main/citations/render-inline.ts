/**
 * In-preview citation rendering (#110).
 *
 * Given a list of `[[cite::id]]` / `[[quote::ex]]` references in
 * document order, run them through a fresh `CitationRenderer` keyed
 * to the project's configured CSL style and return the inline markers
 * (HTML strings citeproc-js produces). For numeric styles we also
 * return a bibliography — author-date / note styles already carry
 * their own context inline.
 *
 * The render is stateful inside a single call (citeproc tracks
 * citation order, ibid., short-form rules) — but we throw the
 * renderer away after each invocation so the next preview render
 * starts fresh. Cheap enough; citeproc operates on a few dozen items.
 */
import { loadCitationAssets } from '../publish/csl';
import { getBibliographyStyleId } from '../project-config';
import { BUNDLED_STYLES, DEFAULT_STYLE } from '../publish/csl/assets';

export interface InlineCiteRequest {
  kind: 'cite' | 'quote';
  id: string;
}

export interface InlineCiteResponse {
  /** Citeproc-rendered HTML markers, one per input request, same order. */
  markers: string[];
  /**
   * Bibliography entries for numeric-style citations. `null` for
   * author-date / note styles, where inline marks are self-explanatory
   * and a preview bibliography would be redundant clutter.
   */
  bibliography: string[] | null;
  /** Cited ids the renderer couldn't resolve — surfaced for UI hints. */
  missing: string[];
  /** Style id actually used (after fall-back). */
  styleId: string;
}

/**
 * Detect a numeric-class CSL style by grepping the raw XML for the
 * `citation-format="numeric"` category attribute. citeproc-js doesn't
 * expose this on the engine in a typed way; the regex is robust
 * enough — every CSL style declares its format in the `<info>` block.
 */
function isNumericStyle(rawCsl: string): boolean {
  return /<category[^>]+citation-format="numeric"/.test(rawCsl);
}

export async function renderInlineCitations(
  rootPath: string,
  refs: InlineCiteRequest[],
): Promise<InlineCiteResponse> {
  const projectStyleId = getBibliographyStyleId(rootPath) ?? DEFAULT_STYLE;
  const styleId = Object.prototype.hasOwnProperty.call(BUNDLED_STYLES, projectStyleId)
    ? projectStyleId
    : DEFAULT_STYLE;

  const assets = await loadCitationAssets(rootPath, { styleId });
  const renderer = assets.createRenderer();

  const markers: string[] = [];
  for (const ref of refs) {
    if (ref.kind === 'quote') {
      const ex = assets.excerpts.get(ref.id);
      if (ex) {
        markers.push(renderer.renderCitation(ex.sourceId, ex.locator));
      } else {
        markers.push(renderer.renderCitation(ref.id));
      }
    } else {
      markers.push(renderer.renderCitation(ref.id));
    }
  }

  const numeric = isNumericStyle(BUNDLED_STYLES[styleId]);
  const bibliography = numeric ? renderer.renderBibliography().entries : null;

  return {
    markers,
    bibliography,
    missing: [...renderer.missing()],
    styleId,
  };
}
