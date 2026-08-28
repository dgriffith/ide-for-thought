/**
 * Process-wide embedder singleton (#835), specifically `disposeSharedEmbedder`
 * (#1898) — previously declared but never called anywhere, now wired into
 * `main.ts`'s `before-quit` handler alongside the other subsystem shutdowns.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  instances: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
}));

vi.mock('../../../src/main/embeddings/embedder-service', () => ({
  createEmbedderService: vi.fn(() => {
    const instance = { dim: 384, embed: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined) };
    h.instances.push(instance);
    return instance;
  }),
}));

import { getSharedEmbedder, disposeSharedEmbedder } from '../../../src/main/embeddings/shared-embedder';

afterEach(async () => {
  await disposeSharedEmbedder();
  h.instances.length = 0;
  vi.clearAllMocks();
});

describe('getSharedEmbedder', () => {
  it('returns the same instance on repeated calls (process-wide singleton)', () => {
    const a = getSharedEmbedder();
    const b = getSharedEmbedder();
    expect(a).toBe(b);
    expect(h.instances).toHaveLength(1);
  });
});

describe('disposeSharedEmbedder', () => {
  it('terminates the current instance and lets a later call create a fresh one', async () => {
    const first = getSharedEmbedder();
    await disposeSharedEmbedder();

    expect(first.dispose).toHaveBeenCalledTimes(1);

    const second = getSharedEmbedder();
    expect(second).not.toBe(first);
    expect(h.instances).toHaveLength(2);
  });

  it('is a safe no-op when no embedder has been created yet', async () => {
    await expect(disposeSharedEmbedder()).resolves.toBeUndefined();
    expect(h.instances).toHaveLength(0);
  });
});
