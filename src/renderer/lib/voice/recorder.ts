/**
 * Microphone capture for dictation (#voice).
 *
 * `getUserMedia` → `MediaRecorder` collects compressed audio while the user
 * speaks; on stop we decode the blob with an `AudioContext` and hand the raw
 * channel data to the pure helpers in `pcm.ts` for downmix + resample to the
 * 16 kHz mono float track Whisper expects.
 *
 * We don't stream to the recogniser mid-utterance — dictation is push-to-talk
 * (or click-to-toggle): the user finishes, then we transcribe the whole clip.
 * That keeps the model invocation to a single pass and avoids partial-decode
 * bookkeeping.
 */

import { TARGET_SAMPLE_RATE, toMono16k } from './pcm';

/** A live capture session. `stop()` resolves with Whisper-ready samples. */
export interface RecordingSession {
  /** Stop capture, release the mic, and resolve with 16 kHz mono samples. */
  stop(): Promise<Float32Array>;
  /** Abandon capture without producing samples (release the mic). */
  cancel(): void;
}

/** Pick a container/codec the platform's MediaRecorder actually supports. */
function preferredMimeType(): string | undefined {
  // Electron/Chromium reliably encodes Opus in WebM; some builds also offer
  // ogg. Fall back to the UA default (undefined) if neither is advertised.
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

async function decodeToSamples(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  // A fresh context per clip; closed in `finally` so we don't leak the (small,
  // but capped) pool of hardware audio contexts across many dictations.
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
    return toMono16k(channels, audio.sampleRate);
  } finally {
    void ctx.close();
  }
}

/**
 * Begin capturing from the default microphone. Rejects if permission is
 * denied or no input device is available — callers surface that to the user.
 */
export async function startRecording(): Promise<RecordingSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('navigator.mediaDevices.getUserMedia is unavailable in this renderer');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const mimeType = preferredMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  const releaseMic = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    stop() {
      return new Promise<Float32Array>((resolve, reject) => {
        recorder.onstop = () => {
          releaseMic();
          const blob = new Blob(chunks, { type: mimeType ?? recorder.mimeType });
          if (blob.size === 0) {
            resolve(new Float32Array(0));
            return;
          }
          decodeToSamples(blob).then(resolve, reject);
        };
        try {
          recorder.stop();
        } catch (err) {
          releaseMic();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    cancel() {
      try {
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // already stopped
      }
      releaseMic();
    },
  };
}

/** Seconds of audio a sample buffer represents, for UI/empty-clip checks. */
export function durationSeconds(samples: Float32Array): number {
  return samples.length / TARGET_SAMPLE_RATE;
}
