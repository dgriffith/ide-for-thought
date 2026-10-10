/**
 * @vitest-environment happy-dom
 *
 * Meeting-recording capture (#2731), with the browser media APIs faked: the
 * token video track is stopped at once, every source track is released on
 * stop / cancel / failure, and the system track is probed for sound — a
 * missing macOS permission yields exact zeros, not an error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

class FakeTrack {
  stopped = false;
  constructor(readonly kind: 'audio' | 'video') {}
  stop() { this.stopped = true; }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[] = []) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
}

/** What the fake analyser reports for the system track. */
let systemSamples = 0;
const contexts: Array<{ closed: boolean; connections: string[] }> = [];

class FakeAudioContext {
  closed = false;
  connections: string[] = [];
  constructor() { contexts.push(this); }
  createMediaStreamDestination() { return { stream: new FakeStream([new FakeTrack('audio')]) }; }
  createMediaStreamSource(stream: FakeStream) {
    const label = stream === mic ? 'mic' : 'system';
    return { connect: (to: { label?: string }) => { this.connections.push(`${label}->${to.label ?? 'destination'}`); } };
  }
  createAnalyser() {
    return {
      label: 'analyser',
      fftSize: 0,
      getFloatTimeDomainData: (buf: Float32Array) => buf.fill(systemSamples),
    };
  }
  close() { this.closed = true; return Promise.resolve(); }
}

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
let display: FakeStream;
const getDisplayMedia = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  systemSamples = 0;
  contexts.length = 0;
  mic = new FakeStream([new FakeTrack('audio')]);
  display = new FakeStream([new FakeTrack('video'), new FakeTrack('audio')]);
  getDisplayMedia.mockReset().mockImplementation(async () => display);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('MediaStream', FakeStream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => mic, getDisplayMedia },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const { startRecording } = await import('../../../src/renderer/lib/voice/recorder');

describe('startRecording({ systemAudio: true }) (#2731)', () => {
  it('asks for audio with a token video track, and stops the video at once', async () => {
    const session = await startRecording({ systemAudio: true });
    expect(getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: { width: 4, height: 4, frameRate: 1 } });
    expect(display.getVideoTracks()[0]!.stopped).toBe(true);
    expect(display.getAudioTracks()[0]!.stopped).toBe(false);
    // Both sources feed the recording; the system track also feeds the probe.
    expect(contexts[0]!.connections).toEqual(['mic->destination', 'system->destination', 'system->analyser']);
    session.cancel();
  });

  it('releases the mic, the system audio and the mixing context when it stops', async () => {
    const session = await startRecording({ systemAudio: true });
    const blob = await session.stopBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(mic.tracks.every((t) => t.stopped)).toBe(true);
    expect(display.tracks.every((t) => t.stopped)).toBe(true);
    expect(contexts[0]!.closed).toBe(true);
  });

  it('reports whether any system audio came through', async () => {
    const silent = await startRecording({ systemAudio: true });
    vi.advanceTimersByTime(2_000);
    expect(silent.heardSystemAudio()).toBe(false);
    silent.cancel();

    const live = await startRecording({ systemAudio: true });
    systemSamples = 0.02;
    vi.advanceTimersByTime(300);
    expect(live.heardSystemAudio()).toBe(true);
    live.cancel();
  });

  it('releases the mic when system audio is declined or missing', async () => {
    getDisplayMedia.mockRejectedValueOnce(new DOMException('declined', 'AbortError'));
    await expect(startRecording({ systemAudio: true })).rejects.toThrow('declined');
    expect(mic.tracks.every((t) => t.stopped)).toBe(true);

    mic = new FakeStream([new FakeTrack('audio')]);
    display = new FakeStream([new FakeTrack('video')]); // no audio offered
    await expect(startRecording({ systemAudio: true })).rejects.toThrow(/No system audio was offered/);
    expect(mic.tracks.every((t) => t.stopped)).toBe(true);
    expect(display.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('a plain recording never asks for system audio', async () => {
    const session = await startRecording();
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(session.heardSystemAudio()).toBeNull();
    session.cancel();
    expect(mic.tracks.every((t) => t.stopped)).toBe(true);
  });
});
