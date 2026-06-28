/**
 * Dictation state machine (#voice).
 *
 * Coordinates the microphone recorder and the Whisper transcriber behind a
 * tiny status surface the UI can bind to. One recording is in flight at a
 * time; the transcriber (and its model) is created lazily and rebuilt only
 * when the user picks a different model in settings.
 */

import { startRecording, durationSeconds, type RecordingSession } from './recorder';
import { createTranscriber, type Transcriber } from './transcriber';
import { voiceSettings } from './voice-settings.svelte';

export type VoiceStatus = 'idle' | 'recording' | 'transcribing';

let status = $state<VoiceStatus>('idle');
let error = $state<string | null>(null);
/** Human-readable model-download progress, or null when not downloading. */
let modelProgress = $state<string | null>(null);

let session: RecordingSession | null = null;
let transcriber: Transcriber | null = null;
let transcriberModel = '';
let unsubProgress: (() => void) | null = null;

function ensureTranscriber(): Transcriber {
  if (transcriber && transcriberModel === voiceSettings.model) return transcriber;
  // Model changed (or first use): drop the old worker so we don't hold two
  // models in memory.
  transcriber?.dispose();
  unsubProgress?.();
  transcriber = createTranscriber(voiceSettings.model);
  transcriberModel = voiceSettings.model;
  unsubProgress = transcriber.onProgress((p) => {
    if (p.total && p.loaded !== undefined && p.status !== 'done' && p.status !== 'ready') {
      const pct = Math.min(100, Math.round((p.loaded / p.total) * 100));
      modelProgress = `Downloading voice model… ${pct}%`;
    } else if (p.status === 'ready' || p.status === 'done') {
      modelProgress = null;
    }
  });
  return transcriber;
}

async function start(): Promise<void> {
  if (status !== 'idle') return;
  error = null;
  try {
    session = await startRecording();
    status = 'recording';
  } catch (e) {
    console.error('[voice] start failed:', e);
    error = micErrorMessage(e);
    status = 'idle';
  }
}

/**
 * Stop recording and transcribe. Resolves with the recognised text (empty
 * string if nothing usable was captured). On failure, sets `error` and
 * resolves with ''.
 */
async function stopAndTranscribe(): Promise<string> {
  if (status !== 'recording' || !session) return '';
  const s = session;
  session = null;
  status = 'transcribing';
  error = null;
  try {
    const pcm = await s.stop();
    if (durationSeconds(pcm) < 0.2) {
      // Too short to be speech — treat as a no-op rather than an error.
      status = 'idle';
      return '';
    }
    const text = await ensureTranscriber().transcribe(pcm);
    status = 'idle';
    modelProgress = null;
    return text;
  } catch (e) {
    console.error('[voice] transcribe failed:', e);
    error = e instanceof Error ? e.message : String(e);
    status = 'idle';
    modelProgress = null;
    return '';
  }
}

function cancel(): void {
  session?.cancel();
  session = null;
  if (status !== 'transcribing') status = 'idle';
}

function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return 'Microphone access was denied.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  return e instanceof Error ? e.message : 'Could not start recording.';
}

export function getVoiceStore() {
  return {
    get status() {
      return status;
    },
    get error() {
      return error;
    },
    get modelProgress() {
      return modelProgress;
    },
    get recording() {
      return status === 'recording';
    },
    get busy() {
      return status !== 'idle';
    },
    start,
    stopAndTranscribe,
    cancel,
    clearError() {
      error = null;
    },
  };
}
