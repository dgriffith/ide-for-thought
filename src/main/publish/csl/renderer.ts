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

/** Footnote bodies collected during a render session, in note-index order. */
export interface RenderedFootnotes {
  /** [{ index: 1, body: '<i>Toulmin</i>, …' }, …] */
  notes: Array<{ index: number; body: string }>;
}

export class CitationRenderer {
  private engine: CslEngine;
  private readonly items: Map<string, CslItem>;
  private readonly citedIds = new Set<string>();
  /** Ids we've been asked to render but couldn't find in `items`. */
  private readonly missingIds = new Set<string>();
  /**
   * 1-based note counter. Note styles use this as the visible footnote
   * marker; in-text styles ignore the value beyond bibliography ordering.
   */
  private noteIndex = 1;
  /** True when the loaded CSL style is class="note" (Chicago full-note, Turabian, …). */
  readonly isNoteStyle: boolean;
  /**
   * Footnote bodies for note-class styles (#297). Populated as
   * `renderCitation` / `renderCitationCluster` fires; the citeproc-rendered
   * text is stashed here and the inline mark is replaced with a `<sup>`
   * marker. Empty for in-text styles.
   */
  private readonly footnotes: Array<{ index: number; body: string }> = [];

  /**
   * Output format passed to citeproc-js. Default `html` matches the
   * note-html / tree-html exporter's needs (italics as `<i>`, etc.);
   * `text` produces clean prose for markdown / plain-text outputs
   * where embedded HTML would be noise (#250).
   */
  readonly outputFormat: 'html' | 'text';

  constructor(
    style: string,
    locale: string,
    items: Map<string, CslItem>,
    opts: { outputFormat?: 'html' | 'text' } = {},
  ) {
    this.items = items;
    this.outputFormat = opts.outputFormat ?? 'html';
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
    if (this.outputFormat === 'text') {
      this.engine.setOutputFormat('text');
    }
    this.isNoteStyle = Boolean(this.engine.cslXml?.dataObj?.attrs?.class === 'note');
  }

  /**
   * Render a single in-text citation. `locator` is a page or range
   * string; when set, citeproc emits "Smith 2020, p. 12" style output.
   * `label` is the CSL locator label ("page", "chapter", "section", …);
   * defaults to "page" for back-compat (#299). The rendered string is
   * HTML (citeproc's default `html` output mode).
   */
  renderCitation(id: string, locator?: string, label?: string): string {
    if (!this.items.has(id)) {
      this.missingIds.add(id);
      return this.outputFormat === 'text'
        ? `[missing: ${id}]`
        : `<span class="csl-missing">[missing: ${escapeHtml(id)}]</span>`;
    }
    return this.renderCitationCluster([{ id, locator, label }]);
  }

  /**
   * Render multiple cites as a single in-text mark — `(Foo 2020; Bar 2021)`
   * in author-date styles, `[1, 2]` in numeric styles, etc. (#298).
   *
   * Caller is responsible for filtering out unknown ids; this method
   * trusts every entry resolves through `retrieveItem`. Empty input
   * returns an empty string. Single-item input is equivalent to
   * `renderCitation` and is the path that single `[[cite::]]` takes.
   * Per-item `label` defaults to "page" when omitted (#299).
   */
  renderCitationCluster(items: Array<{ id: string; locator?: string; label?: string }>): string {
    if (items.length === 0) return '';
    for (const item of items) this.citedIds.add(item.id);
    const citationItems = items.map((item) => {
      const c: Record<string, unknown> = { id: item.id };
      if (item.locator) {
        c.locator = item.locator;
        c.label = item.label ?? 'page';
      }
      return c;
    });
    const noteIndex = this.noteIndex++;
    try {
      const result = this.engine.processCitationCluster(
        { citationItems, properties: { noteIndex } },
        [],
        [],
      );
      const pairs = result[1];
      const text = pairs.length > 0 ? pairs[0][1] : '';
      // Note-class styles: stash the rendered text as a footnote body
      // and emit a `<sup>` marker linking to it (#297). The marker uses
      // a stable id-pair (`fnref-N` / `fn-N`) so the bottom-of-document
      // footnotes section can render back-references.
      if (this.isNoteStyle) {
        this.footnotes.push({ index: noteIndex, body: text });
        // Note-style marker shape depends on output format: Pandoc-style
        // `[^N]` for markdown output, anchored `<sup>` for HTML so the
        // exporter can wire up clickable back-references.
        return this.outputFormat === 'text'
          ? `[^${noteIndex}]`
          : `<sup class="footnote-ref" id="fnref-${noteIndex}"><a href="#fn-${noteIndex}">${noteIndex}</a></sup>`;
      }
      return text;
    } catch (err) {
      const ids = items.map((i) => i.id).join(', ');
      return `<span class="csl-error" title="${escapeHtml(String(err))}">[citation error: ${escapeHtml(ids)}]</span>`;
    }
  }

  /**
   * Footnote bodies collected during this render session (#297). Empty
   * for in-text styles. Order matches the noteIndex citeproc was given,
   * which is the document order of `renderCitationCluster` calls.
   */
  renderFootnotes(): RenderedFootnotes {
    return { notes: this.footnotes.slice() };
  }

  /**
   * Build a bibliography from an explicit list of source ids — decoupled
   * from the per-render `citedIds` set so a tree-html bundle can
   * consolidate citations across many per-note renderers (#300).
   *
   * Unknown ids are silently dropped; valid ids that have already been
   * cited through this engine are fine (citeproc-js de-dupes
   * internally). Returns the same shape as `renderBibliography`.
   */
  renderBibliographyFor(ids: string[]): RenderedBibliography {
    const known = ids.filter((id) => this.items.has(id));
    if (known.length === 0) return { entries: [], isNote: this.isNoteStyle };
    this.engine.updateItems(known);
    const result = this.engine.makeBibliography();
    if (!result) return { entries: [], isNote: this.isNoteStyle };
    const [, rawEntries] = result as [{ hangingindent?: boolean; 'second-field-align'?: string }, string[]];
    return { entries: rawEntries, isNote: this.isNoteStyle };
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
