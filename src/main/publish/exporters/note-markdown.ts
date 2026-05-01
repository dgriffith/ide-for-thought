/**
 * Clean-markdown exporter (#250).
 *
 * The "paste anywhere" exporter. Rewrites wiki-links via the plan's
 * linkPolicy, replaces `[[cite::id]]` / `[[quote::id]]` with
 * CSL-rendered prose, drops embedded Turtle blocks (not portable),
 * and appends a `## References` (or footnote bodies for note-class
 * styles) at the bottom of the file.
 *
 * Diverges from the passthrough `markdown` exporter: that one is for
 * Minerva-internal use and preserves \`[[cite::]]\` syntax; this one
 * produces output that renders correctly on GitHub, Substack, Hugo,
 * and the wider markdown ecosystem outside Minerva.
 *
 * Deferred to follow-up tickets:
 *   - copy-to-dir / inline-base64 image asset policies (this exporter
 *     ships with `keep-relative` only)
 *   - Hugo-flavoured frontmatter remapping
 *   - preview-dialog warnings about dropped Turtle blocks / executable
 *     cells (the warnings would need an IPC-side preview hook)
 */

import {
  buildLinkResolverContext,
  rewriteWikiLinksInContent,
  type LinkResolverContext,
} from '../link-resolver';
import { parseLocatorAlias } from './note-html/render';
import type { Exporter, ExportPlan } from '../types';
import type { CitationRenderer } from '../csl';

export const noteMarkdownExporter: Exporter = {
  id: 'note-markdown',
  label: 'Note as Clean Markdown',
  // Single-note + folder + project; tree mode belongs to a future
  // bundle-shaped markdown exporter (`#291`).
  accepts: (input) => input.kind !== 'tree',
  acceptedKinds: ['single-note', 'folder', 'project'],
  // eslint-disable-next-line @typescript-eslint/require-await
  async run(plan) {
    const ctx = buildLinkResolverContext(plan);
    const notes = plan.inputs.filter((f) => f.kind === 'note');
    // Single-note scope: drop the directory structure so a note at
    // `notes/foo/bar.md` exported to `~/Desktop` lands as
    // `~/Desktop/bar.md`. Multi-note keeps the source tree so
    // `follow-to-file` cross-links still resolve.
    const flatten = notes.length === 1;
    const files = notes.map((f) => {
      // Each note gets its own renderer — citeproc tracks citation
      // ordering on the engine, so a per-note instance gives each
      // page its own References section.
      const renderer = plan.citations?.createRenderer({ outputFormat: 'text' });
      const transformed = transformNoteBody(f.content, ctx, renderer, plan.citations);
      const withRefs = renderer ? appendCitationsTail(transformed, renderer) : transformed;
      return {
        path: flatten ? basename(f.relativePath) : f.relativePath,
        contents: withRefs,
      };
    });
    const dropped = plan.excluded.length;
    const summary = files.length === 1
      ? `Exported "${plan.inputs[0]?.title ?? 'note'}" as clean markdown.`
      : `${files.length} note${files.length === 1 ? '' : 's'} exported as clean markdown${dropped > 0 ? ` (${dropped} excluded)` : ''}.`;
    return { files, summary };
  },
};

/**
 * Apply every body-level rewrite that has to happen before the
 * References footer is appended.
 *
 * Order matters: citation rewrite first so the citation regex sees the
 * raw `[[cite::]]` markers, then wiki-link rewrite (which deliberately
 * skips cite/quote tokens), then Turtle-block strip last so we don't
 * leave dangling `<-- minerva:turtle -->` HTML comments next to a
 * rewritten link.
 */
function transformNoteBody(
  content: string,
  ctx: LinkResolverContext,
  renderer: CitationRenderer | undefined,
  citations: ExportPlan['citations'],
): string {
  let out = content;
  if (renderer && citations) {
    out = rewriteCitations(out, renderer, citations);
  }
  out = rewriteWikiLinksInContent(out, ctx);
  out = stripTurtleBlocks(out);
  return out;
}

/**
 * Walk the markdown content for `[[cite::id]]` / `[[quote::id]]` runs
 * (separated only by whitespace, the same merge gate the HTML exporter
 * uses — #298) and replace each run with citeproc-rendered prose.
 *
 * Mirrors the parser logic in `note-html/render.ts` but emits plain
 * text instead of HTML markers. Kept inline rather than shared because
 * the markdown side has different escaping needs and a different
 * handling for missing ids (no `<span>` wrapper).
 */
function rewriteCitations(
  content: string,
  renderer: CitationRenderer,
  citations: NonNullable<ExportPlan['citations']>,
): string {
  // Skip rewriting inside fenced code blocks — `[[cite::]]` inside a
  // code fence is example syntax, not a real citation.
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
    // Collect a whitespace-separated run, same as the HTML exporter.
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

interface ParsedCite {
  kind: 'cite' | 'quote';
  id: string;
  aliasLocator: { locator: string; label: string } | null;
  endPos: number;
}

function parseCiteAt(src: string, pos: number): ParsedCite | null {
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

/**
 * Resolve a run of cites to a plain-text rendering. Mirrors the
 * HTML-side missing-fallback semantics: any unresolvable id in a run
 * disables the merge so the missing markers stay visible.
 */
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
 * Append a References footer (in-text styles) or footnote bodies
 * (note styles like Chicago full-note). Emits nothing when no
 * citations fired — clean markdown with no References footer is the
 * common case for non-academic notes.
 */
function appendCitationsTail(body: string, renderer: CitationRenderer): string {
  if (renderer.isNoteStyle) {
    const fns = renderer.renderFootnotes().notes;
    if (fns.length === 0) return body;
    // Pandoc-style footnote definitions: `[^N]: <body>` separated by
    // blank lines. Pairs with the `[^N]` markers the renderer emitted.
    const defs = fns.map((n) => `[^${n.index}]: ${n.body}`).join('\n\n');
    return `${body.replace(/\s*$/, '')}\n\n${defs}\n`;
  }
  const bib = renderer.renderBibliography();
  if (bib.entries.length === 0) return body;
  const items = bib.entries.map((e) => `- ${e.trim()}`).join('\n');
  return `${body.replace(/\s*$/, '')}\n\n## References\n\n${items}\n`;
}

/**
 * Strip embedded Turtle blocks (\`\`\`turtle … \`\`\`) — they're meaningful
 * inside Minerva (graph indexing) but noise outside it. Keeps other
 * fenced blocks (sparql, sql, python, shell, prose) intact since
 * those round-trip through standard markdown renderers.
 */
function stripTurtleBlocks(content: string): string {
  return content.replace(/^```turtle\b[\s\S]*?^```\s*\n?/gm, '');
}

function basename(relativePath: string): string {
  return relativePath.split('/').pop() ?? relativePath;
}
