/**
 * End-to-end export driver for the UX surface (#282).
 *
 * `runExport` is the single entry point the renderer invokes after the
 * user confirms the preview dialog. It resolves the plan, runs the
 * selected exporter, and writes the resulting files under the chosen
 * output directory. Path traversal out of `outputDir` is rejected so a
 * hand-crafted exporter or a malformed plan can't scribble elsewhere
 * on the user's disk.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getExporter } from './registry';
import { resolvePlan, runExporter } from './pipeline';
import type { ExportInput, LinkPolicy, AssetPolicy } from './types';

export interface RunExportInput {
  exporterId: string;
  input: ExportInput;
  outputDir: string;
  linkPolicy?: LinkPolicy;
  assetPolicy?: AssetPolicy;
  /** CSL style id (#301). Falls back to the bundled default when absent. */
  citationStyle?: string;
  /** CSL locale id (#301). Falls back to en-US. */
  citationLocale?: string;
}

export interface RunExportResult {
  /** Count of files actually written to disk. */
  filesWritten: number;
  /** Exporter-provided summary string for the success toast. */
  summary: string;
  /** Absolute path to the directory we wrote into. */
  outputDir: string;
  /**
   * Absolute paths of the files the exporter wrote. Surfaced in the
   * success dialog so a user who exported to their home dir isn't
   * left wondering which nested folder the file landed in.
   */
  writtenPaths: string[];
}

export async function runExport(
  rootPath: string,
  args: RunExportInput,
): Promise<RunExportResult> {
  const exporter = getExporter(args.exporterId);
  if (!exporter) throw new Error(`No exporter registered with id "${args.exporterId}"`);

  const plan = await resolvePlan(rootPath, args.input, {
    linkPolicy: args.linkPolicy,
    assetPolicy: args.assetPolicy,
    citationStyle: args.citationStyle,
    citationLocale: args.citationLocale,
    outputDir: args.outputDir,
  });
  const output = await runExporter(exporter, plan);

  const absOutputDir = path.resolve(args.outputDir);
  await fs.mkdir(absOutputDir, { recursive: true });

  const writtenPaths: string[] = [];
  for (const f of output.files) {
    const destAbs = path.resolve(absOutputDir, f.path);
    // Guard against path traversal: every written file must sit under the
    // chosen output dir. An exporter that emits `../escape.md` would
    // otherwise clobber files outside the user's intended sandbox.
    if (!isUnder(destAbs, absOutputDir)) {
      throw new Error(`Exporter "${args.exporterId}" attempted to write outside the output directory: ${f.path}`);
    }
    await fs.mkdir(path.dirname(destAbs), { recursive: true });
    if (typeof f.contents === 'string') {
      await fs.writeFile(destAbs, f.contents, 'utf-8');
    } else {
      await fs.writeFile(destAbs, f.contents);
    }
    writtenPaths.push(destAbs);
  }

  return {
    filesWritten: writtenPaths.length,
    summary: output.summary,
    outputDir: absOutputDir,
    writtenPaths,
  };
}

function isUnder(candidate: string, parent: string): boolean {
  const rel = path.relative(parent, candidate);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}
