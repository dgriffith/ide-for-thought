/**
 * The Whisper worker loads ONNX Runtime's WASM from the bundle (#2564).
 * transformers.js sets `wasmPaths` to cdn.jsdelivr.net on import; the worker
 * must clear it so onnxruntime-web falls back to the asset Vite emits beside
 * its bundle. (Measured in the real app: with the override in place and the
 * CDN unreachable, the model fails with "no available backend found".)
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  env: {
    allowLocalModels: true,
    useBrowserCache: false,
    backends: {
      onnx: {
        wasm: {
          wasmPaths: {
            mjs: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@x/dist/ort-wasm-simd-threaded.asyncify.mjs',
            wasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@x/dist/ort-wasm-simd-threaded.asyncify.wasm',
          },
        },
      },
    },
  },
}));

vi.mock('@huggingface/transformers', () => ({ env: h.env, pipeline: vi.fn() }));
vi.stubGlobal('self', { postMessage: vi.fn(), onmessage: null });

describe('whisper.worker ONNX Runtime WASM source (#2564)', () => {
  it('clears the CDN wasmPaths transformers.js sets on load', async () => {
    await import('../../../src/renderer/lib/voice/whisper.worker');
    expect(h.env.backends.onnx.wasm).not.toHaveProperty('wasmPaths');
    // Model weights still come from the hub, cached by the browser.
    expect(h.env.allowLocalModels).toBe(false);
    expect(h.env.useBrowserCache).toBe(true);
  });
});
