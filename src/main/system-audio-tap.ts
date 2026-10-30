/**
 * System audio for meeting recordings (#2731): runs the bundled Swift helper
 * (`native/audio-tap/main.swift`) and forwards the PCM it prints to the window
 * that asked.
 *
 * Why a helper and not `getDisplayMedia`: Electron's loopback audio needs a
 * screen as its video source, and asking for one shows macOS's full "record
 * your screen" prompt, measured on hardware. A Core Audio process tap needs
 * only "System Audio Recording Only", which macOS charges to Minerva as the
 * process that started the helper.
 *
 * One tap per window. Stopping closes the helper's stdin, its signal to tear
 * down, and kills it if it hasn't gone within `STOP_GRACE_MS`. Its stdin
 * closes however main goes, so it never outlives the app.
 *
 * Electron-free, so it's tested with a fake `spawn`; `register-app.ts` binds
 * it to the window.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { bundledResourcesRoot } from './bundled-resources';
import { logger } from '../shared/logger';

export interface SystemAudioFormat {
  sampleRate: number;
  channels: number;
}

/** How long the helper gets to report ready (or an error) before it's killed. */
export const READY_TIMEOUT_MS = 10_000;
/** How long a stopped helper gets to tear down before it's killed. */
export const STOP_GRACE_MS = 2_000;

/**
 * Whether this OS can record system audio: Core Audio process taps arrived in
 * macOS 14.2 (Darwin 23.2). `osRelease` is `os.release()`, the kernel version.
 */
export function supportsSystemAudioCapture(platform: string, osRelease: string): boolean {
  if (platform !== 'darwin') return false;
  const [major = 0, minor = 0] = osRelease.split('.').map((n) => Number.parseInt(n, 10) || 0);
  return major > 23 || (major === 23 && minor >= 2);
}

/** Where the built helper is, in a checkout or the packaged app. */
export function audioTapPath(): string {
  return path.join(bundledResourcesRoot(), 'bin', 'minerva-audio-tap');
}

type Spawn = (file: string, args: string[], opts: { stdio: ['pipe', 'pipe', 'pipe'] }) => ChildProcess;

export interface SystemAudioTaps {
  /** Start the tap for `owner`, replacing one it already has. Resolves once
   *  the helper reports its format; PCM chunks then go to `send`. */
  start(owner: number, send: (chunk: Uint8Array) => void): Promise<SystemAudioFormat>;
  /** Stop `owner`'s tap, if it has one. */
  stop(owner: number): void;
}

export function createSystemAudioTaps(
  { spawn = nodeSpawn, helperPath = audioTapPath }: { spawn?: Spawn; helperPath?: () => string } = {},
): SystemAudioTaps {
  const running = new Map<number, ChildProcess>();

  function stop(owner: number): void {
    const child = running.get(owner);
    if (!child) return;
    running.delete(owner);
    child.stdin?.end();
    const kill = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
    kill.unref?.();
    child.once('exit', () => clearTimeout(kill));
  }

  function start(owner: number, send: (chunk: Uint8Array) => void): Promise<SystemAudioFormat> {
    stop(owner);
    const child = spawn(helperPath(), [], { stdio: ['pipe', 'pipe', 'pipe'] });
    running.set(owner, child);

    return new Promise<SystemAudioFormat>((resolve, reject) => {
      let format: SystemAudioFormat | null = null;
      let stderr = '';
      // A read can end mid-sample; carry the remainder so every chunk sent is
      // whole frames.
      let carry = Buffer.alloc(0);

      const fail = (message: string) => {
        if (format) return;
        clearTimeout(timer);
        if (running.get(owner) === child) stop(owner);
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail('The system audio recorder didn\'t start in time.'), READY_TIMEOUT_MS);
      timer.unref?.();

      child.on('error', (err) => fail(`Couldn't start the system audio recorder: ${err.message}`));
      child.on('exit', (code) => {
        if (running.get(owner) === child) running.delete(owner);
        fail(`The system audio recorder stopped before it started (exit ${code ?? 'signal'}).`);
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf8');
        let newline: number;
        while ((newline = stderr.indexOf('\n')) >= 0) {
          const line = stderr.slice(0, newline).trim();
          stderr = stderr.slice(newline + 1);
          if (!line) continue;
          let message: { ready?: boolean; sampleRate?: number; channels?: number; error?: string; status?: number };
          try {
            message = JSON.parse(line) as typeof message;
          } catch {
            logger('voice').warn('audio tap:', line);
            continue;
          }
          if (message.error) {
            logger('voice').error('audio tap failed:', message.error, message.status);
            fail(message.error);
          } else if (message.ready && !format) {
            const sampleRate = Number(message.sampleRate);
            const channels = Number(message.channels);
            if (!(sampleRate > 0) || !(channels > 0)) {
              fail('The system audio recorder reported a format it can\'t use.');
              continue;
            }
            clearTimeout(timer);
            format = { sampleRate, channels };
            resolve(format);
          }
        }
      });

      child.stdout?.on('data', (data: Buffer) => {
        if (!format) return;
        const bytes = carry.length ? Buffer.concat([carry, data]) : data;
        const frameBytes = 4 * format.channels;
        const whole = bytes.length - (bytes.length % frameBytes);
        carry = Buffer.from(bytes.subarray(whole));
        // A copy: a view into Node's pooled slab would clone the whole slab.
        if (whole > 0) send(new Uint8Array(bytes.subarray(0, whole)));
      });
    });
  }

  return { start, stop };
}
