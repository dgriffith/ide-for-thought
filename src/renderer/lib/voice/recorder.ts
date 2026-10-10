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
  /** Stop capture, release the mic, and resolve with the encoded audio itself
   *  — what a saved recording keeps (#2428). Empty if nothing was captured. */
  stopBlob(): Promise<Blob>;
  /** For a recording with system audio (#2731): whether any came through.
   *  Null for a mic-only recording. */
  heardSystemAudio(): boolean | null;
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
  return decodeAudioFile(await blob.arrayBuffer());
}

/**
 * Decode an encoded audio file (WebM/Opus, MP3, WAV, …) to Whisper-ready
 * 16 kHz mono samples. The context runs at 16 kHz, so `decodeAudioData`
 * resamples as it decodes: a 30-minute recording comes back as ~115 MB of
 * samples, not the ~345 MB it would be at the mic's 48 kHz (#2428).
 */
export async function decodeAudioFile(bytes: ArrayBuffer): Promise<Float32Array> {
  // A fresh context per clip; closed in `finally` so we don't leak the (small,
  // but capped) pool of hardware audio contexts across many dictations.
  const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  try {
    const audio = await ctx.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
    return toMono16k(channels, audio.sampleRate);
  } finally {
    void ctx.close();
  }
}

export interface RecordingOptions {
  /**
   * Also record the sound the computer plays — the other side of a call
   * (#2731). Mixed with the mic into one track. Needs the main process's
   * display-media handler and, on macOS, 14.2+ with the System Audio
   * Recording permission.
   */
  systemAudio?: boolean;
}

/**
 * Begin capturing from the default microphone (and, with `systemAudio`, the
 * system's audio output). Rejects if permission is denied or no input device
 * is available — callers surface that to the user.
 */
export async function startRecording(opts: RecordingOptions = {}): Promise<RecordingSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('navigator.mediaDevices.getUserMedia is unavailable in this renderer');
  }
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  if (!opts.systemAudio) {
    return recordStream(mic, () => stopTracks(mic), () => null);
  }

  let mix: SystemAudioMix;
  try {
    mix = await mixWithSystemAudio(mic);
  } catch (err) {
    stopTracks(mic);
    throw err;
  }
  return recordStream(mix.stream, mix.release, mix.heardSound);
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

interface SystemAudioMix {
  /** Mic + system audio, mixed to one track. */
  stream: MediaStream;
  /** True once any system audio above silence has come through. */
  heardSound: () => boolean;
  /** Stop every source track and close the mixing context. */
  release: () => void;
}

/**
 * Ask main for system audio (`getDisplayMedia`, answered with loopback audio
 * by `installDisplayMediaHandler`) and mix it with `mic`. The video track is
 * required to get the audio at all — 4×4 at 1 fps, since a 0×0 request comes
 * back silent on Electron 40+ — and is stopped at once.
 *
 * A missing macOS permission or Info.plist string doesn't fail: it yields a
 * stream of exact zeros. So the system track is watched, and `heardSound`
 * reports whether anything ever came through.
 */
async function mixWithSystemAudio(mic: MediaStream): Promise<SystemAudioMix> {
  if (!navigator.mediaDevices.getDisplayMedia) {
    throw new Error('System audio capture is unavailable in this renderer');
  }
  const display = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: { width: 4, height: 4, frameRate: 1 },
  });
  for (const track of display.getVideoTracks()) track.stop();
  const systemTracks = display.getAudioTracks();
  if (systemTracks.length === 0) {
    stopTracks(display);
    throw new Error('No system audio was offered. Meeting recordings need macOS 14.2 or later.');
  }

  const ctx = new AudioContext();
  const destination = ctx.createMediaStreamDestination();
  ctx.createMediaStreamSource(mic).connect(destination);
  const system = ctx.createMediaStreamSource(new MediaStream(systemTracks));
  system.connect(destination);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  system.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let heard = false;
  const probe = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    if (buf.some((x) => Math.abs(x) > 1e-4)) {
      heard = true;
      clearInterval(probe);
    }
  }, 250);

  return {
    stream: destination.stream,
    heardSound: () => heard,
    release: () => {
      clearInterval(probe);
      stopTracks(mic);
      stopTracks(display);
      void ctx.close();
    },
  };
}

/** Record `stream` until stopped; `release` frees its sources afterwards. */
function recordStream(
  stream: MediaStream,
  release: () => void,
  heardSystemAudio: () => boolean | null,
): RecordingSession {
  const mimeType = preferredMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  function stopBlob(): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        release();
        resolve(new Blob(chunks, { type: mimeType ?? recorder.mimeType }));
      };
      try {
        recorder.stop();
      } catch (err) {
        release();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  return {
    async stop() {
      const blob = await stopBlob();
      if (blob.size === 0) return new Float32Array(0);
      return decodeToSamples(blob);
    },
    stopBlob,
    heardSystemAudio,
    cancel() {
      try {
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // already stopped
      }
      release();
    },
  };
}

/** A user-facing message for a failed `startRecording`. */
export function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return 'Microphone access was denied.';
  // getDisplayMedia rejects with AbortError when main declines the request.
  if (name === 'AbortError') return 'System audio capture was declined.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  return e instanceof Error ? e.message : 'Could not start recording.';
}

/** Seconds of audio a sample buffer represents, for UI/empty-clip checks. */
export function durationSeconds(samples: Float32Array): number {
  return samples.length / TARGET_SAMPLE_RATE;
}
