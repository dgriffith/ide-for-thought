/// <reference lib="webworker" />
/**
 * Whisper speech-to-text Web Worker (#voice).
 *
 * Runs `@huggingface/transformers` off the UI thread so a multi-second
 * transcription never janks the editor. In a worker (browser context)
 * transformers.js selects the `onnxruntime-web` (WASM) backend — the native
 * `onnxruntime-node` binary is never loaded, which is the whole reason the
 * voice engine lives in the renderer rather than the main process (matching
 * the embeddings/tesseract precedent of WASM-in-renderer ML).
 *
 * Model weights are fetched from the HF hub on first use and cached by the
 * browser Cache API thereafter — the same shape as tesseract.js pulling its
 * trained data from a CDN. Only weights are fetched; captured audio never
 * leaves the process.
 */

import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';
import type { WhisperRequest, WhisperResponse } from './messages';

declare const self: DedicatedWorkerGlobalScope;

// Fetch from the hub (no bundled local copy); cache downloads so the
// first-run cost is paid once.
env.allowLocalModels = false;
env.useBrowserCache = true;

function reply(msg: WhisperResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

const DEFAULT_MODEL = 'Xenova/whisper-base.en';
let pipePromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let loadedModel = DEFAULT_MODEL;

function load(model: string): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!pipePromise) {
    loadedModel = model;
    pipePromise = pipeline('automatic-speech-recognition', model, {
      // q8 keeps base.en near ~50MB and runs comfortably on CPU/WASM.
      dtype: 'q8',
      device: 'wasm',
      // onnxruntime-web's default ('all') graph optimization runs a
      // TransposeDQWeightsForMatMulNBits pass that fails on Whisper's merged
      // decoder embed-token weights ("Missing required scale"). Dropping to
      // 'basic' skips that pass; the model still runs, just without that
      // (CPU-irrelevant) rewrite.
      session_options: { graphOptimizationLevel: 'basic' },
      progress_callback: (p: { status?: string; loaded?: number; total?: number }) => {
        reply({ type: 'progress', status: p.status ?? 'loading', loaded: p.loaded, total: p.total });
      },
    });
  }
  return pipePromise;
}

self.onmessage = (e: MessageEvent<WhisperRequest>) => {
  const msg = e.data;
  void (async () => {
    try {
      if (msg.type === 'load') {
        await load(msg.model);
        reply({ type: 'ready' });
        return;
      }
      // transcribe — `load` is idempotent, so this just awaits the pipeline
      // the preceding `load` message already kicked off.
      const transcriber = await load(loadedModel);
      const out = (await transcriber(msg.pcm, {
        // Dictation clips are usually short, but chunking lets a long
        // ramble transcribe correctly instead of truncating at 30s.
        chunk_length_s: 30,
        stride_length_s: 5,
      })) as { text?: string } | { text?: string }[];
      const text = Array.isArray(out)
        ? out.map((o) => o.text ?? '').join(' ')
        : (out.text ?? '');
      reply({ type: 'result', id: msg.id, text: text.trim() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply({ type: 'error', id: msg.type === 'transcribe' ? msg.id : undefined, message });
    }
  })();
};
