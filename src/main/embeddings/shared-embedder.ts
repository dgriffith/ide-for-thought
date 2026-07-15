/**
 * Process-wide embedder singleton (#835).
 *
 * The model is project-independent, so one worker serves every open project.
 * Resolves the bundled-model location from electron (`process.resourcesPath`
 * packaged, repo `resources/` in dev) and hands it to the off-thread service.
 */

import { app } from 'electron';
import path from 'node:path';
import { createEmbedderService, type EmbedderService } from './embedder-service';

let shared: EmbedderService | null = null;

export function getSharedEmbedder(resourcesBaseOverride?: string): EmbedderService {
  if (!shared) {
    // `app` is absent outside electron (CLI, unit tests). The CLI passes an
    // explicit base derived from its bundle location — the cwd fallback below is
    // wrong there, since the CLI can be run from any directory. In dev/test with
    // no override, fall back to the repo's resources dir.
    const resourcesBase = resourcesBaseOverride ?? (app?.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(process.cwd(), 'resources'));
    shared = createEmbedderService({ resourcesBase });
  }
  return shared;
}

export async function disposeSharedEmbedder(): Promise<void> {
  const s = shared;
  shared = null;
  if (s) await s.dispose();
}
