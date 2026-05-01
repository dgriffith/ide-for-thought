/**
 * Derived-note builder (#244).
 *
 * "Save cell output as a note" produces a markdown file that:
 *
 *   - Declares its provenance in frontmatter (`derived_from`,
 *     `derived_from_cell`, `derived_at`) so the graph indexer can emit
 *     `prov:wasDerivedFrom` triples.
 *   - Renders the cell output as first-class markdown — a table for
 *     `type:"table"`, a fenced code block for `text`, pretty JSON for
 *     `json`.
 *   - Closes with a prose paragraph that wiki-links back to the
 *     originating cell — shows up as a backlink on the source note.
 */

import type { CellOutput } from './types';

export interface BuildDerivedNoteInput {
  /** Human-readable title. If omitted, derived from the source path. */
  title?: string;
  /** The cell output to serialize into the body. */
  output: CellOutput;
  /** Relative path of the note that owns the source cell. */
  sourcePath: string;
  /** Stable id of the source cell (from its fence info string). */
  cellId: string;
  /** Override the timestamp (tests use a fixed clock). */
  now?: () => Date;
  /**
   * Relative path the derived note will be written to. Used to compute
   * relative `![](…)` image paths so a saved chart resolves correctly
   * regardless of how deep the derived note sits. When omitted, the
   * default `notes/derived/<stem>-<cellId>.md` shape from
   * `defaultDerivedNotePath` is assumed.
   */
  derivedPath?: string;
}

export interface BuildDerivedNoteResult {
  /** The note's markdown body (frontmatter + heading + rendered output + backlink). */
  markdown: string;
  /**
   * Sidecar files the saver should write alongside the note. Image and
   * SVG outputs (#243) produce one entry here; tabular and JSON
   * outputs leave the array empty.
   *
   * `relativePath` is project-relative (e.g.
   * `.minerva/assets/derived/foo-123.png`); the markdown body
   * references it via a path made relative to the note itself.
   */
  assets: Array<{ relativePath: string; contents: Uint8Array | string }>;
}

export function buildDerivedNote(input: BuildDerivedNoteInput): BuildDerivedNoteResult {
  const now = (input.now ?? (() => new Date()))().toISOString();
  const title = input.title ?? defaultTitleFrom(input.sourcePath, input.cellId);
  const derivedPath = input.derivedPath ?? defaultDerivedNotePath(input.sourcePath, input.cellId);

  // `derived_from` is emitted as a wiki-link form so the frontmatter
  // indexer resolves it to the source note's URI — that's what lets
  // backlinks show the derived note on the source's backlinks panel.
  // The indexer drops the `.md`, so we do too for canonical form.
  const sourceTarget = input.sourcePath.replace(/\.md$/i, '');
  const frontmatter = [
    '---',
    `title: ${yamlString(title)}`,
    `derived_from: ${yamlString(`[[${sourceTarget}]]`)}`,
    `derived_from_cell: ${yamlString(input.cellId)}`,
    `derived_at: ${yamlString(now)}`,
    `derived_tool: minerva-compute`,
    `tags: [derived]`,
    '---',
  ].join('\n');

  const { body, assets } = renderOutputForDerivedNote(input.output, {
    derivedPath,
    cellId: input.cellId,
    sourcePath: input.sourcePath,
  });

  // Wiki-link target is the source note's basename (anchors on its
  // `cell-<id>` slug), matching Minerva's existing `[[path#anchor]]`
  // linking convention. The graph indexer treats this as a real
  // incoming link, so backlinks on the source note surface the new
  // derived note automatically.
  const backlinkTarget = linkTargetForSource(input.sourcePath);
  const backlink = `*Derived from [[${backlinkTarget}#cell-${input.cellId}]] on ${now.slice(0, 10)}.*`;

  const markdown = `${frontmatter}\n\n# ${escapeHeading(title)}\n\n${body}\n\n${backlink}\n`;
  return { markdown, assets };
}

// ── Output → markdown ──────────────────────────────────────────────────────

/**
 * Render an output for the derived note. Pure body shape — no
 * frontmatter, no backlink — used by the clipboard "Copy as markdown"
 * affordance and by the asset-aware variant below.
 *
 * Image and HTML outputs (#243) get rendered through the asset-aware
 * variant since they need sidecar files; this string-only path falls
 * back to a code block so the clipboard helper still produces
 * something legible.
 */
export function renderOutputToMarkdown(output: CellOutput): string {
  if (output.type === 'table') {
    return renderTableToMarkdown(output.columns, output.rows);
  }
  if (output.type === 'text') {
    return '```\n' + output.value.replace(/\n$/, '') + '\n```';
  }
  if (output.type === 'json') {
    return '```json\n' + JSON.stringify(output.value, null, 2) + '\n```';
  }
  if (output.type === 'image') {
    // Clipboard path for an image — embed as a data URL so a paste into
    // GitHub/Substack/etc. still renders. The asset-aware path used by
    // "Save as note" produces a sidecar file + relative `![](…)`.
    if (output.mime === 'image/png') {
      return `![](data:image/png;base64,${output.data})`;
    }
    return '```svg\n' + output.data + '\n```';
  }
  if (output.type === 'html') {
    return output.html;
  }
  return '```\n' + JSON.stringify(output) + '\n```';
}

/**
 * Asset-aware variant: image and SVG outputs produce a sidecar file
 * under `.minerva/assets/derived/` and an `![](relative-path)` body.
 * Other output types route through the string-only path above.
 */
function renderOutputForDerivedNote(
  output: CellOutput,
  ctx: { derivedPath: string; cellId: string; sourcePath: string },
): { body: string; assets: BuildDerivedNoteResult['assets'] } {
  if (output.type === 'image') {
    const ext = output.mime === 'image/png' ? 'png' : 'svg';
    const stem = pathStem(ctx.sourcePath);
    const assetRel = `.minerva/assets/derived/${stem}-${ctx.cellId}.${ext}`;
    const contents: Uint8Array | string = output.mime === 'image/png'
      ? base64ToBytes(output.data)
      : output.data;
    const relFromNote = relativeFromNoteToAsset(ctx.derivedPath, assetRel);
    return {
      body: `![](${relFromNote})`,
      assets: [{ relativePath: assetRel, contents }],
    };
  }
  return { body: renderOutputToMarkdown(output), assets: [] };
}

/**
 * Path made relative from a note's directory to a project-rooted
 * asset path. Independent of `node:path` so this stays usable in the
 * renderer / browser without polyfills.
 */
function relativeFromNoteToAsset(notePath: string, assetPath: string): string {
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  const noteSegments = noteDir ? noteDir.split('/') : [];
  const assetSegments = assetPath.split('/');
  let common = 0;
  while (
    common < noteSegments.length
    && common < assetSegments.length
    && noteSegments[common] === assetSegments[common]
  ) common++;
  const ups = noteSegments.length - common;
  const upParts: string[] = Array.from({ length: ups }, () => '..');
  const downs = assetSegments.slice(common);
  return [...upParts, ...downs].join('/');
}

function base64ToBytes(b64: string): Uint8Array {
  // Buffer is the cheapest path in Node; the renderer doesn't run this
  // code (it sticks to renderOutputToMarkdown for clipboard rendering).
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function renderTableToMarkdown(
  columns: string[],
  rows: Array<Array<string | number | boolean | null>>,
): string {
  if (columns.length === 0) return '*(empty result)*';
  const header = `| ${columns.map(escapeTableCell).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) =>
    `| ${r.map((v) => escapeTableCell(v == null ? '' : String(v))).join(' | ')} |`,
  );
  return [header, divider, ...body].join('\n');
}

function escapeTableCell(s: string): string {
  // Pipes break the markdown table grammar; escape them. Newlines in
  // cell values get squashed to spaces so the row stays on one line.
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

// ── Helpers ────────────────────────────────────────────────────────────────

function defaultTitleFrom(sourcePath: string, cellId: string): string {
  const base = sourcePath.split('/').pop() ?? sourcePath;
  const stem = base.replace(/\.md$/i, '');
  return `${stem} — cell ${cellId}`;
}

function pathStem(relativePath: string): string {
  const base = relativePath.split('/').pop() ?? 'note';
  return base
    .replace(/\.md$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'note';
}

/**
 * Default path for a derived note. `<dir>/<source-stem>-<cellId>.md`
 * under `notes/derived/` — puts every derived note in one place so
 * users can browse or prune them as a unit, without burying them in
 * the original analysis folder.
 */
export function defaultDerivedNotePath(sourcePath: string, cellId: string): string {
  const base = sourcePath.split('/').pop() ?? 'note.md';
  const stem = base
    .replace(/\.md$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `notes/derived/${stem}-${cellId}.md`;
}

/**
 * The target used inside `[[…]]` — the source note's relative path
 * with the `.md` dropped. Matches Minerva's wiki-link convention.
 */
function linkTargetForSource(sourcePath: string): string {
  return sourcePath.replace(/\.md$/i, '');
}

function yamlString(s: string): string {
  // Always emit a double-quoted YAML string so special chars inside
  // titles / dates / paths can't break the frontmatter parser.
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function escapeHeading(s: string): string {
  // H1 should render as plain text; markdown-it tolerates most content
  // on a heading line, but backslash-escape special tokens defensively.
  return s.replace(/#/g, '\\#');
}
