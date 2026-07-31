/**
 * Headless context-from-files for the skill-eval harness (#1522).
 *
 * The renderer's `gatherContext` (src/renderer/lib/tools/context.ts) builds a
 * `ToolContext` from the live editor + IPC — CodeMirror selections, `api.*`
 * calls. The eval harness can't use it (no Electron, no editor), so this module
 * builds the SAME flat `ToolContext` from case files + the initialized graph:
 * file reads for note/source bodies, `graph.*` lookups for the derived
 * neighborhood (relatedNotes/taggedNotes/claim metadata). It mirrors
 * `gatherContext` field-for-field, gating each on the skill's declared
 * `context` requirements so the packaged prompt only carries what the skill asks
 * for — exactly as at runtime.
 *
 * Kept deliberately separate from the renderer helper (the issue is explicit:
 * do NOT reuse `gatherContext`). The graph helpers here are the same ones
 * `src/cli/engine.ts` drives (`backlinks`/`outgoingLinks`), so this stays on the
 * audited Electron-free core.
 */
import path from 'node:path';
import * as graph from '../main/graph/index';
import { readFile } from '../main/notebase/fs';
import { extractClaimUri } from '../shared/refactor/find-arguments';
import type { ProjectContext } from '../main/project-context-types';
import type { ThinkingToolDef, ToolContext } from '../shared/tools/types';

/** Context references in a case manifest — pointers into the thoughtbase (mode
 *  a) and/or inline overrides (mode b). All optional; a skill only reads the
 *  fields its `context` requirements name. */
export interface CaseContextRefs {
  /** Note path relative to the thoughtbase root (reference mode). */
  note?: string;
  /** Title to use when the note body is supplied inline (no path to derive from). */
  noteTitle?: string;
  /** Selected passage (verbatim). */
  selection?: string;
  /** Source id under `.minerva/sources/<id>/` (reference mode). */
  source?: string;
}

/** Note body / selection supplied inline via `input/*` files, for synthetic
 *  cases that don't live in the shared thoughtbase (mode b). */
export interface InlineInputs {
  note?: string;
  selection?: string;
  sourceBody?: string;
}

function titleFromPath(relativePath: string): string {
  return path.basename(relativePath).replace(/\.md$/, '');
}

/**
 * Build the flat `ToolContext` a skill's `buildPrompt` / `buildSystemPrompt`
 * consumes, gated on `def.context`. `ctx` must already be initialized
 * (`initGraph` + `indexAllNotes`) so the graph-derived fields resolve.
 */
export async function buildEvalContext(
  ctx: ProjectContext,
  def: ThinkingToolDef,
  refs: CaseContextRefs,
  inline: InlineInputs = {},
): Promise<ToolContext> {
  const req = new Set(def.context);
  const out: ToolContext = {};

  // Resolve the note once (reference wins over inline) — several requirements
  // draw from it.
  let notePath: string | undefined;
  let noteContent: string | undefined;
  let noteTitle: string | undefined;
  if (refs.note) {
    notePath = refs.note;
    noteContent = await readFile(ctx.rootPath, refs.note);
    noteTitle = titleFromPath(refs.note);
  } else if (inline.note !== undefined) {
    noteContent = inline.note;
    noteTitle = refs.noteTitle ?? 'Untitled';
  }

  const selection = refs.selection ?? inline.selection;

  if (req.has('fullNote') && noteContent !== undefined) {
    out.fullNoteContent = noteContent;
    if (notePath) out.fullNotePath = notePath;
    out.fullNoteTitle = noteTitle ?? 'Untitled';
  }

  if (req.has('selectedText') && selection) {
    out.selectedText = selection;
  }

  // Derive character offsets + 1-based lines for the selection, matching
  // CodeMirror's inclusive-start / exclusive-end semantics that `gatherContext`
  // records. Uses the first occurrence of the selection in the note body.
  if (req.has('selectionRange') && selection && noteContent) {
    const start = noteContent.indexOf(selection);
    if (start >= 0) {
      const end = start + selection.length;
      out.selectionStartOffset = start;
      out.selectionEndOffset = end;
      out.selectionStartLine = lineAt(noteContent, start);
      out.selectionEndLine = lineAt(noteContent, Math.max(start, end - 1));
    }
  }

  if (req.has('claimUnderCursor') && selection) {
    const uri = extractClaimUri(selection);
    if (uri) {
      out.claimUri = uri;
      const meta = await claimMetadata(ctx, uri);
      if (meta) {
        out.claimLabel = meta.label;
        out.claimSourceText = meta.sourceText;
      }
    }
  }

  if (req.has('relatedNotes') && notePath) {
    out.relatedNotes = await relatedNotes(ctx, notePath);
  }

  if (req.has('taggedNotes') && notePath) {
    out.taggedNotes = await taggedNotes(ctx, notePath);
  }

  // Source-scoped context (#103) — from `.minerva/sources/<id>/`.
  const needsSourceMeta = req.has('sourceMetadata');
  const needsSourceBody = req.has('sourceBody');
  if ((needsSourceMeta || needsSourceBody) && refs.source) {
    out.sourceId = refs.source;
    if (needsSourceMeta) {
      const detail = graph.getSourceDetail(ctx, refs.source);
      if (detail) {
        out.sourceMetadata = detail.metadata;
        out.sourceTitle = detail.metadata.title ?? '';
      }
    }
    if (needsSourceBody) {
      out.sourceBody =
        inline.sourceBody ??
        (await readFile(ctx.rootPath, `.minerva/sources/${refs.source}/body.md`).catch(() => ''));
    }
  }

  // `parameterValues` is threaded in by the harness (eval.ts) from the case
  // manifest's `parameters`, keeping this function purely context-derivation.

  return out;
}

/**
 * Pre-fill every skill parameter with its `defaultValue` (or ''), exactly as the
 * invocation dialog (`ToolParamsDialog.svelte`) does — it seeds `paramValues`
 * from `p.defaultValue ?? ''` for *every* parameter, so at runtime the rendered
 * prompt always sees all params. A case's explicit values override the defaults.
 */
export function applyParamDefaults(
  def: ThinkingToolDef,
  provided: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of def.parameters ?? []) {
    out[p.id] = provided[p.id] ?? p.defaultValue ?? '';
  }
  // Keep any extra keys the case supplied that aren't declared params (harmless).
  for (const [k, v] of Object.entries(provided)) if (!(k in out)) out[k] = v;
  return out;
}

/**
 * Resolve `note`-type parameter companions (#516), headless mirror of the
 * renderer's `resolve-note-params.ts`: for each note param holding a picked
 * path, read that note from the thoughtbase and expose its body + title as the
 * companion vars `{{param.<id>.content}}` / `{{param.<id>.title}}` (the picked
 * path stays as `{{param.<id>}}`). Used by the harness so a skill like
 * find-tensions, which compares the active note against a second one, packages
 * the same prompt Minerva would. Returns a new merged map.
 */
export async function resolveNoteParamCompanions(
  ctx: ProjectContext,
  def: ThinkingToolDef,
  values: Record<string, string>,
): Promise<Record<string, string>> {
  const out = { ...values };
  for (const p of def.parameters ?? []) {
    if (p.type !== 'note') continue;
    const rel = out[p.id];
    if (!rel) continue;
    out[`${p.id}.title`] = titleFromPath(rel);
    try {
      out[`${p.id}.content`] = await readFile(ctx.rootPath, rel);
    } catch {
      // Picked note unreadable — keep path + title, omit content (as the app does).
    }
  }
  return out;
}

/** 1-based line number of a character offset in `text`. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/** Union of a note's outgoing + incoming link targets, with their bodies —
 *  the same neighborhood `gatherContext` assembles from `api.links.*`, here from
 *  the graph directly (as `src/cli/engine.ts` does). */
async function relatedNotes(
  ctx: ProjectContext,
  notePath: string,
): Promise<{ path: string; title: string; content: string }[]> {
  const paths = new Set<string>();
  for (const l of graph.outgoingLinks(ctx, notePath)) if (l.target) paths.add(l.target);
  for (const b of graph.backlinks(ctx, notePath)) if (b.source) paths.add(b.source);
  paths.delete(notePath);
  return readNotes(ctx, [...paths]);
}

/** Notes sharing any tag with `notePath` (excluding itself). Mirrors
 *  `gatherContext`'s tag walk, via `listTags` + `notesByTag`. */
async function taggedNotes(
  ctx: ProjectContext,
  notePath: string,
): Promise<{ path: string; title: string; content: string }[]> {
  const noteTags = graph
    .listTags(ctx)
    .map((t) => t.tag)
    .filter((tag) => graph.notesByTag(ctx, tag).some((n) => n.relativePath === notePath));

  const paths = new Set<string>();
  for (const tag of noteTags) {
    for (const n of graph.notesByTag(ctx, tag)) {
      if (n.relativePath !== notePath) paths.add(n.relativePath);
    }
  }
  return readNotes(ctx, [...paths]);
}

async function readNotes(
  ctx: ProjectContext,
  paths: string[],
): Promise<{ path: string; title: string; content: string }[]> {
  // Sort for deterministic ordering — the packaged prompt must be byte-stable
  // across runs (the harness's whole point, #1522).
  return Promise.all(
    [...paths].sort().map(async (p) => ({
      path: p,
      title: titleFromPath(p),
      content: await readFile(ctx.rootPath, p).catch(() => ''),
    })),
  );
}

/** Look up a claim's label + source text, the way `gatherContext` does after
 *  `extractClaimUri` finds a claim URI. */
async function claimMetadata(
  ctx: ProjectContext,
  uri: string,
): Promise<{ label: string; sourceText: string } | undefined> {
  const { results, error } = await graph.queryGraph(
    ctx,
    `PREFIX thought: <https://minerva.dev/ontology/thought#>
     SELECT ?label ?sourceText WHERE {
       <${uri}> a thought:Claim .
       OPTIONAL { <${uri}> thought:label ?label . }
       OPTIONAL { <${uri}> thought:sourceText ?sourceText . }
     } LIMIT 1`,
  );
  if (error) return undefined;
  const row = (results as Array<{ label?: string; sourceText?: string }>)[0];
  if (!row) return undefined;
  return { label: row.label ?? '', sourceText: row.sourceText ?? '' };
}
