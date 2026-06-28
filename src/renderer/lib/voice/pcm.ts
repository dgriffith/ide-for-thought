/**
 * Pure PCM helpers for the voice pipeline (#voice).
 *
 * Whisper wants mono 16 kHz float samples. The browser hands us decoded
 * audio at the device's capture rate (typically 44.1/48 kHz) across one or
 * more channels, so we downmix and resample here. Keeping this logic pure
 * (no `AudioContext`) lets it be unit-tested without a DOM — the recorder
 * only contributes the `decodeAudioData` call that produces the channel
 * arrays we operate on.
 */

/** Whisper's expected input sample rate. */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Average N channel buffers into a single mono track. All channels are
 * assumed equal length (true for `AudioBuffer.getChannelData`). A single
 * channel is returned as-is.
 */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const len = channels[0].length;
  const out = new Float32Array(len);
  for (const ch of channels) {
    for (let i = 0; i < len; i++) out[i] += ch[i];
  }
  const n = channels.length;
  for (let i = 0; i < len; i++) out[i] /= n;
  return out;
}

/**
 * Resample a mono signal with linear interpolation. Good enough for speech
 * recognition — Whisper's mel frontend is forgiving, and a polyphase filter
 * would be overkill for a dictation feature. Returns the input untouched
 * when the rates already match.
 */
export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) return input;
  if (input.length === 0) return input;
  const ratio = inputRate / outputRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/**
 * Full path from decoded channel data to Whisper-ready samples: downmix to
 * mono, then resample to 16 kHz.
 */
export function toMono16k(channels: Float32Array[], inputRate: number): Float32Array {
  return resampleLinear(mixToMono(channels), inputRate, TARGET_SAMPLE_RATE);
}
