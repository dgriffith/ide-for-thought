/**
 * Export-pipeline types (#246).
 *
 * Every publication target (markdown, HTML, PDF, static site, annotated
 * reading, …) routes through the same foundation: an `ExportInput` names
 * what the user asked for, `resolvePlan` loads the relevant notes and
 * filters out private ones, an `Exporter` turns the plan into files, and
 * the resulting `ExportOutput` lists what to write (and where).
 *
 * Shared so the pipeline, the link resolver, the UI, and every
 * individual exporter all agree on the vocabulary.
 */

/** What the caller asked to export. The pipeline resolves this into a plan. */
export interface ExportInput {
  kind: 'single-note' | 'folder' | 'project' | 'tree' | 'source';
  /**
   * For `single-note`: the note's relative path.
   * For `folder`: the folder's relative path (empty = project root).
   * For `project`: ignored; always the whole project.
   * For `tree`: the root note whose reachable wiki-link closure we bundle.
   * For `source`: the source id (i.e. directory name under `.minerva/sources/`).
   */
  relativePath?: string;
  /**
   * Only meaningful for `kind === 'tree'`. Max BFS depth from the root.
   * `0` = just the root. Unbounded trees are expensive — the default of
   * 3 balances "include everything plausible" against runaway bundles.
   */
  maxDepth?: number;
}

/**
 * How wiki-links render in the exported output.
 *
 *   - `drop`           — link goes away; display text (or target) remains
 *     as plain text. Useful for single-note exports where link targets
 *     aren't in the export set.
 *   - `inline-title`   — link replaced with the target note's title (from
 *     frontmatter or H1). Content-style exports where the reader has no
 *     way to follow the link anyway.
 *   - `follow-to-file` — rewrite to a relative file-link when the target
 *     is part of the export, else fall through to `inline-title`. The
 *     shape for folder / tree exports where the output is readable as a
 *     set of inter-linked files.
 *
 * A `site-relative` policy is planned for the eventual static-site
 * exporter but held back until that ticket lands; its presence here
 * would be speculative.
 */
export type LinkPolicy = 'drop' | 'inline-title' | 'follow-to-file';

/**
 * How media referenced from notes gets handled. Markdown passthrough only
 * needs `keep-relative`; HTML and PDF tickets introduce the others.
 */
export type AssetPolicy = 'keep-relative' | 'copy-to-dir' | 'inline-base64';

/** A note (or source / excerpt) that made it through exclusion and into the plan. */
export interface ExportPlanFile {
  relativePath: string;
  kind: 'note' | 'source' | 'excerpt';
  /** Raw file content as loaded. Exporters transform this. */
  content: string;
  /** Parsed frontmatter; empty object when the file has none. */
  frontmatter: Record<string, unknown>;
  /** Title for link-resolver display — frontmatter.title, H1, or filename stem. */
  title: string;
  /**
   * True when the user manually re-included this file via the preview
   * dialog's exclusion override (#283). The pipeline would otherwise
   * have dropped it via the private-by-default rules. Surfaced so the
   * preview can render an "overridden" badge.
   */
  overridden?: boolean;
}

export interface ExportPlanExclusion {
  relativePath: string;
  /** Human-readable reason for exclusion, surfaced in the preview dialog. */
  reason: string;
}

export interface ExportPlan {
  /**
   * The scope the user picked — preserved here so exporters can
   * distinguish "the whole project" from "a folder that happens to
   * contain every note". The BibTeX exporter, for instance, treats
   * project scope as "whole library" (every loaded source) and
   * folder/single-note as "intersect with what these notes cite".
   */
  inputKind: ExportInput['kind'];
  inputs: ExportPlanFile[];
  excluded: ExportPlanExclusion[];
  linkPolicy: LinkPolicy;
  assetPolicy: AssetPolicy;
  /** CSL style id; exporters ignore when not set. */
  citationStyle?: string;
  /** CSL locale id (#301). Exporters ignore when not set. */
  citationLocale?: string;
  /** Absolute destination directory for exporters that write multiple files. */
  outputDir?: string;
  /**
   * Absolute path to the thoughtbase root. Exporters that inline assets
   * (images, attachments) resolve relative paths against this. Always
   * populated by `resolvePlan` — the `?` keeps tests that build plans
   * by hand readable.
   */
  rootPath?: string;
  /**
   * Citation assets loaded once by `resolvePlan` from the project's
   * sources + excerpts (#247). Exporters call `citations.createRenderer()`
   * to get a per-note stateful renderer — citeproc-js tracks
   * bibliography ordering + first-reference mechanics on the engine
   * itself, so a per-note reset is cheaper than trying to reuse.
   */
  citations?: import('./csl').CitationAssets;
}

/**
 * One file an exporter wants written. Path is relative to the plan's
 * `outputDir`. Binary formats pass `Uint8Array`; everything else strings.
 */
export interface ExportOutputFile {
  path: string;
  contents: string | Uint8Array;
}

export interface ExportOutput {
  files: ExportOutputFile[];
  /** One-line summary the caller can surface in the preview or a toast. */
  summary: string;
}

export interface Exporter {
  /** Stable id — used by the menu registry and IPC. */
  id: string;
  /** Human-readable label for the menu / palette. */
  label: string;
  /** Whether the exporter can handle this input kind. Falsy = hidden in the menu. */
  accepts(input: ExportInput): boolean;
  /**
   * Optional hint for the preview dialog — which input kinds to offer
   * as scope options. When omitted the dialog offers every kind except
   * `tree` (which requires explicit opt-in since not every exporter
   * knows how to walk wiki-link closures).
   */
  acceptedKinds?: ExportInput['kind'][];
  /** Transform plan → output. Exporters never write files directly; that's the pipeline's job. */
  run(plan: ExportPlan): Promise<ExportOutput>;
}
