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
  kind: 'single-note' | 'folder' | 'project';
  /**
   * For `single-note`: the note's relative path.
   * For `folder`: the folder's relative path (empty = project root).
   * For `project`: ignored; always the whole project.
   */
  relativePath?: string;
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
}

export interface ExportPlanExclusion {
  relativePath: string;
  /** Human-readable reason for exclusion, surfaced in the preview dialog. */
  reason: string;
}

export interface ExportPlan {
  inputs: ExportPlanFile[];
  excluded: ExportPlanExclusion[];
  linkPolicy: LinkPolicy;
  assetPolicy: AssetPolicy;
  /** CSL style id; exporters ignore when not set. Populated by a later citations ticket. */
  citationStyle?: string;
  /** Absolute destination directory for exporters that write multiple files. */
  outputDir?: string;
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
  /** Transform plan → output. Exporters never write files directly; that's the pipeline's job. */
  run(plan: ExportPlan): Promise<ExportOutput>;
}
