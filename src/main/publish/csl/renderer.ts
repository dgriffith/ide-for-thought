/**
 * Citation renderer — thin wrapper around citeproc-js (#247).
 *
 * Exposes the two operations exporters actually need:
 *   - `renderCitation(id, locator)` — in-text mark for a `[[cite::id]]`
 *     or `[[quote::excerpt-id]]` reference. Records the id so the
 *     bibliography only lists what was actually cited.
 *   - `renderBibliography()` — the consolidated References section,
 *     ordered per the CSL style (alphabetical in APA, citation-order
 *     in IEEE, etc.).
 *
 * citeproc-js's API is clunky; keeping the wrapper narrow means
 * exporters don't have to learn it.
 */

import CSL, { Engine as CslEngine } from 'citeproc';
import type { CslItem } from './source-to-csl';

export interface RenderedBibliography {
  entries: string[];
  /**
   * When true the CSL style is a footnote-based style (e.g. Chicago
   * full-note) and callers should render the "entries" as footnotes
   * rather than an end-references list. Not used by the v1 APA path
   * but surfaced so exporters can branch later.
   */
  isNote: boolean;
}

export class CitationRenderer {
  private engine: CslEngine;
  private readonly items: Map<string, CslItem>;
  private readonly citedIds = new Set<string>();
  /** Ids we've been asked to render but couldn't find in `items`. */
  private readonly missingIds = new Set<string>();
  private noteIndex = 0;

  constructor(style: string, locale: string, items: Map<string, CslItem>) {
    this.items = items;
    const sys = {
      retrieveItem: (id: string) => {
        const item = this.items.get(id);
        if (!item) {
          // citeproc-js throws on undefined retrieveItem results — we
          // want a controlled miss path instead, so return a stub.
          return { id, type: 'article', title: `[missing: ${id}]` };
        }
        return item;
      },
      retrieveLocale: () => locale,
    };
    this.engine = new CSL.Engine(sys, style);
  }

  /**
   * Render a single in-text citation. `locator` is a page or range
   * string; when set, citeproc emits "Smith 2020, p. 12" style output.
   * The rendered string is HTML (citeproc's default `html` output mode).
   */
  renderCitation(id: string, locator?: string): string {
    if (!this.items.has(id)) {
      this.missingIds.add(id);
      return `<span class="csl-missing">[missing: ${escapeHtml(id)}]</span>`;
    }
    return this.renderCitationCluster([{ id, locator }]);
  }

  /**
   * Render multiple cites as a single in-text mark — `(Foo 2020; Bar 2021)`
   * in author-date styles, `[1, 2]` in numeric styles, etc. (#298).
   *
   * Caller is responsible for filtering out unknown ids; this method
   * trusts every entry resolves through `retrieveItem`. Empty input
   * returns an empty string. Single-item input is equivalent to
   * `renderCitation` and is the path that single `[[cite::]]` takes.
   */
  renderCitationCluster(items: Array<{ id: string; locator?: string }>): string {
    if (items.length === 0) return '';
    for (const item of items) this.citedIds.add(item.id);
    const citationItems = items.map((item) => {
      const c: Record<string, unknown> = { id: item.id };
      if (item.locator) {
        c.locator = item.locator;
        c.label = 'page';
      }
      return c;
    });
    try {
      const result = this.engine.processCitationCluster(
        { citationItems, properties: { noteIndex: this.noteIndex++ } },
        [],
        [],
      );
      const pairs = result[1];
      return pairs.length > 0 ? pairs[0][1] : '';
    } catch (err) {
      const ids = items.map((i) => i.id).join(', ');
      return `<span class="csl-error" title="${escapeHtml(String(err))}">[citation error: ${escapeHtml(ids)}]</span>`;
    }
  }

  /**
   * Render every cited item as a bibliography. Order follows the CSL
   * style's rules. Returns an empty result when no citations fired —
   * exporters should skip emitting the References section in that case.
   */
  renderBibliography(): RenderedBibliography {
    if (this.citedIds.size === 0) return { entries: [], isNote: false };
    this.engine.updateItems([...this.citedIds]);
    const result = this.engine.makeBibliography();
    if (!result) return { entries: [], isNote: false };
    const [params, rawEntries] = result as [{ hangingindent?: boolean; 'second-field-align'?: string }, string[]];
    void params;
    // citeproc-js returns HTML fragments with `<div class="csl-entry">…</div>`
    // wrappers; pass through verbatim — exporters decide whether to strip.
    return {
      entries: rawEntries,
      isNote: Boolean(this.engine.cslXml?.dataObj?.attrs?.class === 'note'),
    };
  }

  /** Every id actually cited in this render session. */
  cited(): ReadonlySet<string> {
    return this.citedIds;
  }

  /** Every id `renderCitation` couldn't find. Surfaced in export audits. */
  missing(): ReadonlySet<string> {
    return this.missingIds;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
