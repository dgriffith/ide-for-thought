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
 * citation order, ibid., short-form rules), so each call starts from a clean
 * session. It used to get that by throwing away the whole renderer — which
 * the original comment here called "cheap enough". It was not: building the
 * engine is ~296ms, fixed, regardless of library size, and this handler runs
 * on the preview's 120ms render debounce. `withPreviewRenderer` now hands
 * back a cached, freshly-reset engine instead; see `./assets-cache.ts` for
 * the measurements and the freshness contract.
 */
import type { ProjectContext } from '../project-context-types';
import { withPreviewRenderer } from './assets-cache';
import { getBibliographyStyleId } from '../project-config';
import { DEFAULT_STYLE } from '../publish/csl/assets';

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
  ctx: ProjectContext,
  refs: InlineCiteRequest[],
): Promise<InlineCiteResponse> {
  // The project's style id goes to `loadCitationAssets` UNFILTERED (#2314).
  //
  // This used to gate it on `BUNDLED_STYLES` first and fall back to APA for
  // anything else — so a user style imported under #302
  // (`.minerva/csl-styles/<id>.csl`) was accepted by the settings picker, used
  // by every exporter, and silently ignored by the preview, which rendered APA
  // instead. `loadCitationAssets` already resolves against the MERGED registry
  // and already falls back to `DEFAULT_STYLE` for an unknown id, so the gate
  // was a second, narrower copy of a decision that was being made correctly
  // one layer down. Deleting it is the fix; `assets.styleId` is the id that
  // was actually used.
  const styleId = getBibliographyStyleId(ctx.rootPath) ?? DEFAULT_STYLE;

  // The callback body is synchronous on purpose — it is one citeproc session
  // on a renderer shared with the next tick, and an `await` in here would let
  // another render interleave into it. See `assets-cache.ts`.
  return await withPreviewRenderer(ctx, { styleId }, (renderer, assets) => {
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

    // Read the RESOLVED style, not `BUNDLED_STYLES[styleId]`. For a user id
    // that lookup is `undefined` (and the non-null assertion on it would have
    // thrown the moment the style resolved); for a user file overriding a
    // bundled id it returns the bundled XML, so a `citation-format` the user
    // changed was read from a style nobody was rendering with — the preview
    // bibliography then appeared or vanished according to the wrong file.
    const numeric = isNumericStyle(assets.style);
    const bibliography = numeric ? renderer.renderBibliography().entries : null;

    return {
      markers,
      bibliography,
      missing: [...renderer.missing()],
      styleId: assets.styleId,
    };
  });
}
