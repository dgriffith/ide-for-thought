/**
 * Export pipeline (#246).
 *
 * `resolvePlan(rootPath, input, opts)` walks the thoughtbase, loads the
 * notes the input specifies, and filters them through the private-by-
 * default exclusion rules. The result — an `ExportPlan` — names exactly
 * what's in the export (and why each dropped file got dropped), for the
 * exporter to transform and the preview dialog to audit.
 *
 * `runExporter(plan, exporter)` is a thin pass-through; the pipeline
 * doesn't write files itself — the exporter's output lists what to
 * write, and the caller (the save-dialog IPC from the UX ticket #282)
 * decides how.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { checkExclusion } from './exclusion';
import { resolveTree, extractWikiLinkTargets } from './tree-resolver';
import { loadCitationAssets } from './csl';
import type {
  ExportInput,
  ExportPlan,
  ExportPlanFile,
  ExportPlanExclusion,
  Exporter,
  ExportOutput,
  LinkPolicy,
  AssetPolicy,
} from './types';

export interface ResolvePlanOptions {
  linkPolicy?: LinkPolicy;
  assetPolicy?: AssetPolicy;
  citationStyle?: string;
  outputDir?: string;
}

export async function resolvePlan(
  rootPath: string,
  input: ExportInput,
  opts: ResolvePlanOptions = {},
): Promise<ExportPlan> {
  const { inputs, excluded } = input.kind === 'tree'
    ? await collectTreeEntries(rootPath, input)
    : await collectFilesystemEntries(rootPath, input);

  const citations = await loadCitationAssets(rootPath, {
    styleId: opts.citationStyle,
  });

  return {
    inputKind: input.kind,
    inputs,
    excluded,
    linkPolicy: opts.linkPolicy ?? 'inline-title',
    assetPolicy: opts.assetPolicy ?? 'keep-relative',
    citationStyle: opts.citationStyle,
    outputDir: opts.outputDir,
    rootPath,
    citations,
  };
}

// ── Tree-mode resolution ────────────────────────────────────────────────────

async function collectTreeEntries(
  rootPath: string,
  input: ExportInput,
): Promise<{ inputs: ExportPlanFile[]; excluded: ExportPlanExclusion[] }> {
  if (!input.relativePath) {
    throw new Error('Tree export requires a root note (input.relativePath).');
  }
  const tree = await resolveTree({
    rootNote: input.relativePath,
    maxDepth: input.maxDepth ?? 3,
    extractLinks: extractWikiLinkTargets,
    async readFile(rel: string) {
      try {
        return await fs.readFile(path.join(rootPath, rel), 'utf-8');
      } catch {
        return null;
      }
    },
    isExcluded: (rel: string, content: string) => checkExclusion(rel, content),
  });

  const inputs: ExportPlanFile[] = tree.included.map((entry) => {
    const { frontmatter, title } = parseHeader(entry.relativePath, entry.content);
    return {
      relativePath: entry.relativePath,
      kind: 'note',
      content: entry.content,
      frontmatter,
      title,
    };
  });
  const excluded: ExportPlanExclusion[] = tree.excluded.map((e) => ({
    relativePath: e.relativePath,
    reason: e.reason,
  }));
  return { inputs, excluded };
}

// ── Filesystem-walk resolution (single-note / folder / project) ─────────────

async function collectFilesystemEntries(
  rootPath: string,
  input: ExportInput,
): Promise<{ inputs: ExportPlanFile[]; excluded: ExportPlanExclusion[] }> {
  const candidatePaths = await collectCandidatePaths(rootPath, input);

  const inputs: ExportPlanFile[] = [];
  const excluded: ExportPlanExclusion[] = [];

  for (const rel of candidatePaths) {
    let content: string;
    try {
      content = await fs.readFile(path.join(rootPath, rel), 'utf-8');
    } catch {
      // File disappeared between the walk and the read — ignore.
      continue;
    }

    const check = checkExclusion(rel, content);
    if (check.excluded) {
      excluded.push({ relativePath: rel, reason: check.reason ?? 'excluded' });
      continue;
    }
    const { frontmatter, title } = parseHeader(rel, content);
    inputs.push({
      relativePath: rel,
      kind: 'note',
      content,
      frontmatter,
      title,
    });
  }

  // Sort for deterministic ordering across exporter runs.
  inputs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  excluded.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { inputs, excluded };
}

export async function runExporter(
  exporter: Exporter,
  plan: ExportPlan,
): Promise<ExportOutput> {
  return exporter.run(plan);
}

// ── Candidate-path collection ───────────────────────────────────────────────

async function collectCandidatePaths(rootPath: string, input: ExportInput): Promise<string[]> {
  if (input.kind === 'single-note') {
    if (!input.relativePath) return [];
    return [input.relativePath];
  }
  const subdir = input.kind === 'folder' ? (input.relativePath ?? '') : '';
  const walkRoot = path.join(rootPath, subdir);
  const paths: string[] = [];
  await walkMarkdown(walkRoot, rootPath, paths);
  return paths;
}

/**
 * Walk a directory and collect every `.md` file relative to `rootPath`.
 * Skips hidden directories (`.git`, `.minerva`, `.obsidian`, …) and
 * `node_modules` — same set the sidebar filters out — so exports match
 * the user's mental model of what's "in" their thoughtbase.
 */
async function walkMarkdown(dir: string, rootPath: string, out: string[]): Promise<void> {
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(full, rootPath, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(path.relative(rootPath, full));
    }
  }
}

// ── Header parsing ─────────────────────────────────────────────────────────

function parseHeader(relativePath: string, content: string): {
  frontmatter: Record<string, unknown>;
  title: string;
} {
  const fm = extractFrontmatter(content);
  const titleFromFm = typeof fm.title === 'string' ? fm.title.trim() : '';
  if (titleFromFm) return { frontmatter: fm, title: titleFromFm };
  // Fall back to the first H1, then the filename stem.
  const bodyAfterFm = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const h1 = bodyAfterFm.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1) return { frontmatter: fm, title: h1[1] };
  const stem = (relativePath.split('/').pop() ?? relativePath).replace(/\.md$/i, '');
  return { frontmatter: fm, title: stem };
}

function extractFrontmatter(content: string): Record<string, unknown> {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  try {
    const parsed: unknown = YAML.parse(m[1]);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
