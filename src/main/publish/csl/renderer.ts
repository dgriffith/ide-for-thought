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

import CSL from 'citeproc';
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
   
  private engine: any;
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
    this.citedIds.add(id);
    const citationItem: Record<string, unknown> = { id };
    if (locator) {
      citationItem.locator = locator;
      citationItem.label = 'page';
    }
    try {
      const result = this.engine.processCitationCluster(
        {
          citationItems: [citationItem],
          properties: { noteIndex: this.noteIndex++ },
        },
        [],
        [],
      );
      // citeproc returns [updateInfo, [[index, text, id], ...]]
      const pairs = result[1] as Array<[number, string, string]>;
      return pairs.length > 0 ? pairs[0][1] : '';
    } catch (err) {
      return `<span class="csl-error" title="${escapeHtml(String(err))}">[citation error: ${escapeHtml(id)}]</span>`;
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
