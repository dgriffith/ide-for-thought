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

export function getSharedEmbedder(): EmbedderService {
  if (!shared) {
    // `app` is absent outside electron (unit tests) — fall back to the repo's
    // resources dir so the dev/test path resolves the bundled model.
    const resourcesBase = app?.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(process.cwd(), 'resources');
    shared = createEmbedderService({ resourcesBase });
  }
  return shared;
}

export async function disposeSharedEmbedder(): Promise<void> {
  const s = shared;
  shared = null;
  if (s) await s.dispose();
}
