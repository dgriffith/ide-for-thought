/**
 * Process-wide embedder singleton (#835).
 *
 * The model is project-independent, so one worker serves every open project.
 * Resolves the bundled-model location via `bundledResourcesRoot()` and hands
 * it to the off-thread service.
 */

import { bundledResourcesRoot } from '../bundled-resources';
import { createEmbedderService, type EmbedderService } from './embedder-service';

let shared: EmbedderService | null = null;

export function getSharedEmbedder(resourcesBaseOverride?: string): EmbedderService {
  if (!shared) {
    // `bundledResourcesRoot()` works in the app, the CLI (no `app` under
    // ELECTRON_RUN_AS_NODE) and tests alike (#2410); the override is a seam.
    const resourcesBase = resourcesBaseOverride ?? bundledResourcesRoot();
    shared = createEmbedderService({ resourcesBase });
  }
  return shared;
}

export async function disposeSharedEmbedder(): Promise<void> {
  const s = shared;
  shared = null;
  if (s) await s.dispose();
}
