/**
 * @vitest-environment node
 *
 * The meeting recorder's system-audio tap (#2731): the helper's protocol (a
 * JSON ready/error line on stderr, raw PCM on stdout), whole frames only to
 * the window that asked, and every way a helper can fail or be stopped.
 * `spawn` is faked; the Swift helper itself is exercised on hardware.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSystemAudioTaps, supportsSystemAudioCapture, audioTapPath, READY_TIMEOUT_MS, STOP_GRACE_MS,
} from '../../src/main/system-audio-tap';
import { silenceLogTags } from '../helpers/quiet-logs';

silenceLogTags('voice');

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdinEnded = false;
  killed: string[] = [];
  constructor() {
    super();
    // Recorded as called: a stream's own 'finish' only fires on a later tick.
    this.stdin.end = (() => { this.stdinEnded = true; return this.stdin; }) as typeof this.stdin.end;
  }
  kill(sig: string) { this.killed.push(sig); return true; }
  say(obj: unknown) { this.stderr.write(`${JSON.stringify(obj)}\n`); }
}

let children: FakeChild[];
let taps: ReturnType<typeof createSystemAudioTaps>;

beforeEach(() => {
  children = [];
  const spawn = vi.fn(() => {
    const c = new FakeChild();
    children.push(c);
    return c as unknown as ChildProcess;
  });
  taps = createSystemAudioTaps({ spawn, helperPath: () => '/bin/minerva-audio-tap' });
});

afterEach(() => { vi.useRealTimers(); });

const tick = () => new Promise((r) => setImmediate(r));
const floats = (...xs: number[]) => Buffer.from(new Float32Array(xs).buffer);

describe('supportsSystemAudioCapture', () => {
  it('needs macOS 14.2 (Darwin 23.2) or later', () => {
    expect(supportsSystemAudioCapture('darwin', '23.2.0')).toBe(true);  // 14.2
    expect(supportsSystemAudioCapture('darwin', '24.6.0')).toBe(true);  // 15.x
    expect(supportsSystemAudioCapture('darwin', '25.0.0')).toBe(true);  // 26
    expect(supportsSystemAudioCapture('darwin', '23.1.0')).toBe(false); // 14.1
    expect(supportsSystemAudioCapture('darwin', '22.6.0')).toBe(false); // 13.x
    expect(supportsSystemAudioCapture('darwin', 'garbage')).toBe(false);
  });

  it('is off elsewhere: the helper is macOS-only', () => {
    expect(supportsSystemAudioCapture('win32', '10.0.26100')).toBe(false);
    expect(supportsSystemAudioCapture('linux', '6.8.0')).toBe(false);
  });
});

it('the helper lives in the bundled resources\' bin/', () => {
  expect(audioTapPath()).toMatch(/resources[/\\]bin[/\\]minerva-audio-tap$/);
});

describe('createSystemAudioTaps', () => {
  it('resolves with the format the helper reports, then sends whole frames', async () => {
    const sent: Uint8Array[] = [];
    const started = taps.start(1, (c) => sent.push(c));
    children[0]!.say({ ready: true, sampleRate: 48000, channels: 2 });
    await expect(started).resolves.toEqual({ sampleRate: 48000, channels: 2 });

    const frames = floats(0.1, 0.2, 0.3, 0.4); // 2 stereo frames, 16 bytes
    children[0]!.stdout.write(frames.subarray(0, 11)); // mid-sample
    children[0]!.stdout.write(frames.subarray(11));
    await tick();
    expect(sent.map((c) => c.byteLength)).toEqual([8, 8]);
    expect([...new Float32Array(Uint8Array.from(Buffer.concat(sent)).buffer)].map((x) => Math.round(x * 10) / 10))
      .toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('sends each chunk as its own copy, not a view into a shared buffer', async () => {
    const sent: Uint8Array[] = [];
    const started = taps.start(1, (c) => sent.push(c));
    children[0]!.say({ ready: true, sampleRate: 48000, channels: 1 });
    await started;
    children[0]!.stdout.write(floats(0.5));
    await tick();
    expect(sent[0]!.byteOffset).toBe(0);
    expect(sent[0]!.buffer.byteLength).toBe(4);
  });

  it('drops anything printed before ready', async () => {
    const sent: Uint8Array[] = [];
    const started = taps.start(1, (c) => sent.push(c));
    children[0]!.stdout.write(floats(1, 1));
    await tick();
    children[0]!.say({ ready: true, sampleRate: 48000, channels: 2 });
    await started;
    expect(sent).toEqual([]);
  });

  it('rejects with the helper\'s own error, e.g. on a Mac too old for taps', async () => {
    const started = taps.start(1, () => {});
    children[0]!.say({ error: "Couldn't create the audio tap.", status: -50 });
    await expect(started).rejects.toThrow("Couldn't create the audio tap.");
    expect(children[0]!.stdinEnded).toBe(true);
  });

  it('rejects when the helper can\'t be run, or exits before ready', async () => {
    const a = taps.start(1, () => {});
    children[0]!.emit('error', new Error('spawn ENOENT'));
    await expect(a).rejects.toThrow(/Couldn't start the system audio recorder: spawn ENOENT/);

    const b = taps.start(2, () => {});
    children[1]!.emit('exit', 1);
    await expect(b).rejects.toThrow(/stopped before it started \(exit 1\)/);
  });

  it('rejects a format it can\'t use, and ignores a stray line', async () => {
    const started = taps.start(1, () => {});
    children[0]!.stderr.write('some framework chatter\n');
    children[0]!.say({ ready: true, sampleRate: 0, channels: 2 });
    await expect(started).rejects.toThrow(/format/);
  });

  it('gives up on a helper that never reports', async () => {
    vi.useFakeTimers();
    const started = taps.start(1, () => {});
    const failed = expect(started).rejects.toThrow(/didn't start in time/);
    vi.advanceTimersByTime(READY_TIMEOUT_MS);
    await failed;
    expect(children[0]!.stdinEnded).toBe(true);
  });

  it('stop closes stdin, and kills a helper that doesn\'t go in time', async () => {
    vi.useFakeTimers();
    const started = taps.start(1, () => {});
    children[0]!.say({ ready: true, sampleRate: 48000, channels: 2 });
    await vi.waitFor(() => expect(children[0]!.listenerCount('exit')).toBeGreaterThan(0));
    await started;
    taps.stop(1);
    expect(children[0]!.stdinEnded).toBe(true);
    expect(children[0]!.killed).toEqual([]);
    vi.advanceTimersByTime(STOP_GRACE_MS);
    expect(children[0]!.killed).toEqual(['SIGKILL']);
  });

  it('a helper that exits after stop isn\'t killed', async () => {
    vi.useFakeTimers();
    const started = taps.start(1, () => {});
    children[0]!.say({ ready: true, sampleRate: 48000, channels: 2 });
    await started;
    taps.stop(1);
    children[0]!.emit('exit', 0);
    vi.advanceTimersByTime(STOP_GRACE_MS);
    expect(children[0]!.killed).toEqual([]);
  });

  it('starting again replaces the window\'s tap; other windows keep theirs', async () => {
    void taps.start(1, () => {}).catch(() => {});
    void taps.start(2, () => {}).catch(() => {});
    void taps.start(1, () => {}).catch(() => {});
    expect(children.map((c) => c.stdinEnded)).toEqual([true, false, false]);
    taps.stop(9); // no tap: nothing happens
    taps.stop(2);
    expect(children[1]!.stdinEnded).toBe(true);
  });
});
