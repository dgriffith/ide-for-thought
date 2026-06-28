/**
 * Wire types shared between the voice UI thread and the Whisper Web Worker
 * (#voice). Kept dependency-free so both the worker bundle and the main
 * renderer bundle can import them without dragging in transformers.js.
 */

/** UI → worker. */
export type WhisperRequest =
  | { type: 'load'; model: string }
  | { type: 'transcribe'; id: number; pcm: Float32Array };

/** worker → UI. */
export type WhisperResponse =
  | { type: 'ready' }
  | { type: 'progress'; status: string; loaded?: number; total?: number }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };
