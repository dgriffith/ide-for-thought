/**
 * @vitest-environment happy-dom
 *
 * Meeting-recording capture (#2731), with the media APIs and main's tap
 * faked: the tap's PCM chunks are scheduled back to back into the mix,
 * de-interleaved per channel; every source is released on stop, cancel and
 * failure; and the chunks are probed for sound, since a missing macOS
 * permission yields exact zeros, not an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ipc = {
  listener: null as null | ((chunk: Uint8Array) => void),
  unsubscribed: 0,
  start: vi.fn(),
  stop: vi.fn(),
};
const tap = {
  start: () => ipc.start() as Promise<{ sampleRate: number; channels: number }>,
  stop: () => ipc.stop() as unknown,
  onChunk: (cb: (chunk: Uint8Array) => void) => {
    ipc.listener = cb;
    return () => { ipc.unsubscribed++; ipc.listener = null; };
  },
};

class FakeTrack {
  stopped = false;
  stop() { this.stopped = true; }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[] = []) {}
  getTracks() { return this.tracks; }
}

interface Scheduled { at: number; channels: number[][]; sampleRate: number }

class FakeAudioContext {
  closed = false;
  currentTime = 5;
  connections: string[] = [];
  scheduled: Scheduled[] = [];
  constructor() { contexts.push(this); }
  createMediaStreamDestination() { return { stream: new FakeStream([new FakeTrack()]) }; }
  createMediaStreamSource() {
    return { connect: () => { this.connections.push('mic'); } };
  }
  createBuffer(channels: number, frames: number, sampleRate: number) {
    const planes = Array.from({ length: channels }, () => new Float32Array(frames));
    return { duration: frames / sampleRate, sampleRate, getChannelData: (c: number) => planes[c]!, planes };
  }
  createBufferSource() {
    const source = {
      buffer: null as null | { sampleRate: number; planes: Float32Array[] },
      connect: () => { this.connections.push('system'); },
      start: (at: number) => {
        this.scheduled.push({ at, sampleRate: source.buffer!.sampleRate, channels: source.buffer!.planes.map((p) => [...p]) });
      },
    };
    return source;
  }
  close() { this.closed = true; return Promise.resolve(); }
}
const contexts: FakeAudioContext[] = [];

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(readonly stream: FakeStream) {}
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x']) });
    this.onstop?.();
  }
}

let mic: FakeStream;

/** Interleaved float32 frames as the bytes main forwards. */
const pcm = (...samples: number[]) => new Uint8Array(new Float32Array(samples).buffer);

beforeEach(() => {
  contexts.length = 0;
  ipc.listener = null;
  ipc.unsubscribed = 0;
  ipc.start.mockReset().mockResolvedValue({ sampleRate: 4, channels: 2 });
  ipc.stop.mockReset().mockResolvedValue(undefined);
  mic = new FakeStream([new FakeTrack()]);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('MediaStream', FakeStream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => mic },
  });
});

async function start(opts: { systemAudio?: typeof tap } = { systemAudio: tap }) {
  const { startRecording } = await import('../../../src/renderer/lib/voice/recorder');
  return startRecording(opts);
}

describe('meeting recordings: system audio from the tap (#2731)', () => {
  it('a plain recording never starts the tap', async () => {
    const s = await start({});
    expect(ipc.start).not.toHaveBeenCalled();
    expect(s.heardSystemAudio()).toBeNull();
  });

  it('mixes the mic, and schedules each chunk right after the last, de-interleaved', async () => {
    await start();
    const ctx = contexts[0]!;
    expect(ctx.connections).toEqual(['mic']);

    ipc.listener!(pcm(0.1, 0.2, 0.3, 0.4)); // 2 frames at 4 Hz: 0.5 s
    ipc.listener!(pcm(0.5, 0.6));          // 1 frame: 0.25 s
    expect(ctx.scheduled.map((s) => s.at)).toEqual([5.1, 5.6]);
    expect(ctx.scheduled[0]!.channels.map((c) => c.map((x) => Math.round(x * 10) / 10))).toEqual([[0.1, 0.3], [0.2, 0.4]]);
    expect(ctx.scheduled[0]!.sampleRate).toBe(4);
  });

  it('restarts just ahead of the clock after a stall', async () => {
    await start();
    const ctx = contexts[0]!;
    ipc.listener!(pcm(0, 0));
    ctx.currentTime = 60;
    ipc.listener!(pcm(0, 0));
    expect(ctx.scheduled.map((s) => s.at)).toEqual([5.1, 60.1]);
  });

  it('reports whether any sound came through — silence is what a denied permission gives', async () => {
    const s = await start();
    ipc.listener!(pcm(0, 0, 0, 0));
    expect(s.heardSystemAudio()).toBe(false);
    ipc.listener!(pcm(0, 0.02));
    expect(s.heardSystemAudio()).toBe(true);
  });

  it('copes with a chunk whose bytes start at an odd offset', async () => {
    await start();
    const backing = new Uint8Array(9);
    backing.set(pcm(0.5, 0.25), 1);
    ipc.listener!(backing.subarray(1));
    expect(contexts[0]!.scheduled[0]!.channels).toEqual([[0.5], [0.25]]);
  });

  it('stops the tap, the mic and the mix when the recording stops', async () => {
    const s = await start();
    await s.stopBlob();
    expect(ipc.stop).toHaveBeenCalledOnce();
    expect(ipc.unsubscribed).toBe(1);
    expect(mic.tracks[0]!.stopped).toBe(true);
    expect(contexts[0]!.closed).toBe(true);
  });

  it('releases everything on cancel', async () => {
    const s = await start();
    s.cancel();
    expect(ipc.stop).toHaveBeenCalledOnce();
    expect(mic.tracks[0]!.stopped).toBe(true);
  });

  it('when the tap can\'t start: the mic and the mix are released, and the error passes on', async () => {
    ipc.start.mockRejectedValue(new Error("Error invoking remote method 'app:startSystemAudio': Error: Couldn't create the audio tap."));
    await expect(start()).rejects.toThrow(/Couldn't create the audio tap/);
    expect(ipc.unsubscribed).toBe(1);
    expect(mic.tracks[0]!.stopped).toBe(true);
    expect(contexts[0]!.closed).toBe(true);
  });

  it('shows main\'s message without the IPC wrapper', async () => {
    const { micErrorMessage } = await import('../../../src/renderer/lib/voice/recorder');
    expect(micErrorMessage(new Error("Error invoking remote method 'app:startSystemAudio': Error: Couldn't create the audio tap.")))
      .toBe("Couldn't create the audio tap.");
  });
});
