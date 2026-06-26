import { describe, it, expect, afterEach } from 'vitest';
import { createEmbedderService } from '../../../src/main/embeddings/embedder-service';
import { MODEL } from '../../../src/main/embeddings/embedder';

// The service's worker round-trip is covered by the packaged-app offline check
// (it needs the built embed-worker.js). Here we cover the main-thread plumbing
// that doesn't spawn: dim passthrough and the empty-batch short-circuit.
describe('createEmbedderService (plumbing)', () => {
  let svc: ReturnType<typeof createEmbedderService>;
  afterEach(async () => { await svc?.dispose(); });

  it('reports the model dimensionality', () => {
    svc = createEmbedderService({ workerPath: '/nonexistent-worker.js' });
    expect(svc.dim).toBe(MODEL.dim);
  });

  it('short-circuits an empty batch without spawning the worker', async () => {
    // A bogus worker path would throw if a worker were spawned — proving the
    // empty case never touches it.
    svc = createEmbedderService({ workerPath: '/nonexistent-worker.js' });
    await expect(svc.embed([])).resolves.toEqual([]);
  });

  it('dispose is safe when no worker was ever spawned', async () => {
    svc = createEmbedderService({ workerPath: '/nonexistent-worker.js' });
    await expect(svc.dispose()).resolves.toBeUndefined();
  });
});
