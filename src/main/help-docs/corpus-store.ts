/**
 * Loads the precomputed help-docs corpus (#1285, epic:docs-grounding, #1154).
 *
 * The corpus is a static, project-independent asset built ahead of time by
 * `scripts/build-help-corpus.mjs` (#1284) into `resources/help-docs/corpus.json`
 * — one process-global load, cached for the app's lifetime, mirroring
 * `shared-embedder.ts`'s singleton and its dev/packaged path resolution.
 */

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { MODEL } from '../embeddings/embedder';
import { logger } from '../../shared/logger';

export interface HelpDocChunk {
  id: string;
  sourcePage: string;
  pageTitle: string;
  heading: string;
  text: string;
  vector: number[];
}

interface CorpusFile {
  model: string;
  dim: number;
  generatedAt: string;
  chunks: HelpDocChunk[];
}

let cached: HelpDocChunk[] | null = null;

function corpusPath(resourcesBaseOverride?: string): string {
  const resourcesBase = resourcesBaseOverride ?? (app?.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(process.cwd(), 'resources'));
  return path.join(resourcesBase, 'help-docs', 'corpus.json');
}

/**
 * Load (and cache) the help-docs corpus. Returns `[]` — never throws — if the
 * file is missing (not yet built, e.g. a fresh checkout before `pnpm predev`
 * has run) or was built against a different embedding model than the one this
 * build of the app ships (a model upgrade would otherwise silently compare
 * vectors from two incompatible embedding spaces).
 */
export function getHelpDocsCorpus(resourcesBaseOverride?: string): HelpDocChunk[] {
  if (cached) return cached;

  const file = corpusPath(resourcesBaseOverride);
  if (!fs.existsSync(file)) {
    logger('help-docs').warn(`corpus not found at ${file} — run "pnpm fetch:help-corpus"`);
    cached = [];
    return cached;
  }

  let parsed: CorpusFile;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as CorpusFile;
  } catch (err) {
    logger('help-docs').warn(`corpus at ${file} is not valid JSON — ignoring: ${(err as Error).message}`);
    cached = [];
    return cached;
  }

  if (parsed.model !== MODEL.name || parsed.dim !== MODEL.dim) {
    logger('help-docs').warn(
      `corpus was built with model "${parsed.model}" (dim ${parsed.dim}), ` +
      `but this app ships "${MODEL.name}" (dim ${MODEL.dim}) — ignoring stale corpus`,
    );
    cached = [];
    return cached;
  }

  cached = parsed.chunks;
  return cached;
}

/** Test-only: force the next `getHelpDocsCorpus()` call to reload from disk. */
export function resetHelpDocsCorpusCache(): void {
  cached = null;
}
