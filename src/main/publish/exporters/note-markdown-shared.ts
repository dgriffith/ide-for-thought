/**
 * Shared markdown-rewriting helpers for the clean-markdown exporters
 * (#250 single-note + #291 tree zip).
 *
 * Both exporters need the same cite/quote → CSL prose rewrite and
 * the same turtle-block strip. They diverge on what tail to append:
 *
 *   - Single-note: per-note footnotes (note styles) OR per-note
 *     `## References` (in-text styles).
 *   - Tree zip: per-note footnotes only (note styles' `[^N]` markers
 *     anchor locally); the consolidated `references.md` lives at the
 *     bundle root.
 */

import { parseLocatorAlias } from './note-html/render';
import type { ExportPlan } from '../types';
import type { CitationRenderer } from '../csl';

export interface ParsedCite {
  kind: 'cite' | 'quote';
  id: string;
  aliasLocator: { locator: string; label: string } | null;
  endPos: number;
}

/**
 * Walk the content for `[[cite::id]]` / `[[quote::id]]` runs and
 * replace each run with citeproc-rendered prose. Skips fenced code
 * blocks (where `[[cite::]]` is example syntax). Whitespace-merge
 * gate matches the HTML exporter (#298).
 */
export function rewriteCitations(
  content: string,
  renderer: CitationRenderer,
  citations: NonNullable<ExportPlan['citations']>,
): string {
  const FENCE_RE = /^```[\s\S]*?^```/gm;
  const fenceSpans: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(content)) !== null) {
    fenceSpans.push({ start: m.index, end: m.index + m[0].length });
  }
  const isInsideFence = (idx: number): boolean =>
    fenceSpans.some((s) => idx >= s.start && idx < s.end);

  const out: string[] = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] !== '[' || content[i + 1] !== '[' || isInsideFence(i)) {
      out.push(content[i]);
      i++;
      continue;
    }
    const first = parseCiteAt(content, i);
    if (!first) {
      out.push(content[i]);
      i++;
      continue;
    }
    const run: ParsedCite[] = [first];
    let scanPos = first.endPos;
    while (true) {
      let p = scanPos;
      while (p < content.length && /\s/.test(content[p])) p++;
      const next = parseCiteAt(content, p);
      if (!next) break;
      run.push(next);
      scanPos = next.endPos;
    }
    out.push(renderCiteRun(run, renderer, citations));
    i = scanPos;
  }
  return out.join('');
}

export function parseCiteAt(src: string, pos: number): ParsedCite | null {
  if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) return null;
  const close = src.indexOf(']]', pos + 2);
  if (close < 0) return null;
  const inner = src.slice(pos + 2, close);
  const m = inner.match(/^(cite|quote)::(.+)$/i);
  if (!m) return null;
  const rawTarget = m[2];
  const pipe = rawTarget.indexOf('|');
  const id = (pipe >= 0 ? rawTarget.slice(0, pipe) : rawTarget).trim();
  const alias = pipe >= 0 ? rawTarget.slice(pipe + 1).trim() : '';
  return {
    kind: m[1].toLowerCase() as 'cite' | 'quote',
    id,
    aliasLocator: parseLocatorAlias(alias),
    endPos: close + 2,
  };
}

function renderCiteRun(
  items: ParsedCite[],
  renderer: CitationRenderer,
  citations: NonNullable<ExportPlan['citations']>,
): string {
  type Resolved =
    | { ok: true; sourceId: string; locator?: string; label?: string }
    | { ok: false; missingMarker: string };
  const resolved: Resolved[] = items.map((item) => {
    if (item.kind === 'quote') {
      const ex = citations.excerpts.get(item.id);
      if (!ex) return { ok: false, missingMarker: `[missing excerpt: ${item.id}]` };
      if (!citations.items.has(ex.sourceId)) return { ok: false, missingMarker: `[missing: ${ex.sourceId}]` };
      return {
        ok: true,
        sourceId: ex.sourceId,
        locator: item.aliasLocator?.locator ?? ex.locator,
        label: item.aliasLocator?.label,
      };
    }
    if (!citations.items.has(item.id)) return { ok: false, missingMarker: `[missing: ${item.id}]` };
    return {
      ok: true,
      sourceId: item.id,
      locator: item.aliasLocator?.locator,
      label: item.aliasLocator?.label,
    };
  });
  if (items.length === 1 || resolved.some((r) => !r.ok)) {
    return resolved
      .map((r) => (r.ok ? renderer.renderCitation(r.sourceId, r.locator, r.label) : r.missingMarker))
      .join(' ');
  }
  return renderer.renderCitationCluster(
    resolved.map((r) => {
      const ok = r as Extract<Resolved, { ok: true }>;
      return { id: ok.sourceId, locator: ok.locator, label: ok.label };
    }),
  );
}

/**
 * Strip embedded ```turtle blocks — meaningful inside Minerva (graph
 * indexing) but noise outside it.
 */
export function stripTurtleBlocks(content: string): string {
  return content.replace(/^```turtle\b[\s\S]*?^```\s*\n?/gm, '');
}

/**
 * Append per-note Pandoc-style footnote definitions. Note-class
 * styles only — in-text styles return the body unchanged.
 */
export function appendFootnoteDefs(body: string, renderer: CitationRenderer): string {
  if (!renderer.isNoteStyle) return body;
  const fns = renderer.renderFootnotes().notes;
  if (fns.length === 0) return body;
  const defs = fns.map((n) => `[^${n.index}]: ${n.body}`).join('\n\n');
  return `${body.replace(/\s*$/, '')}\n\n${defs}\n`;
}

/**
 * Append a per-note `## References` section. In-text styles only —
 * note-class styles defer to `appendFootnoteDefs`.
 */
export function appendReferencesSection(body: string, renderer: CitationRenderer): string {
  if (renderer.isNoteStyle) return body;
  const bib = renderer.renderBibliography();
  if (bib.entries.length === 0) return body;
  const items = bib.entries.map((e) => `- ${e.trim()}`).join('\n');
  return `${body.replace(/\s*$/, '')}\n\n## References\n\n${items}\n`;
}

/**
 * Rewrite cites + strip turtle + append per-note footnote defs (note
 * styles only). Used by the tree-zip exporter where the consolidated
 * `references.md` carries the bibliography for in-text styles.
 */
export function rewriteCitationsAndCleanup(
  content: string,
  renderer: CitationRenderer | undefined,
  citations: ExportPlan['citations'],
): string {
  let out = content;
  if (renderer && citations) {
    out = rewriteCitations(out, renderer, citations);
  }
  out = stripTurtleBlocks(out);
  if (renderer) out = appendFootnoteDefs(out, renderer);
  return out;
}
