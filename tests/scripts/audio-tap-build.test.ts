/**
 * @vitest-environment node
 *
 * Building the meeting-recording helper (#2731), `scripts/lib/audio-tap-build.mjs`:
 * the right `swiftc` target per arch, a rebuild only when the source or target
 * changed (a content hash, not mtimes — #2246), and nothing off macOS. `swiftc`
 * is faked; the real compile runs in every macOS package build.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AUDIO_TAP_BINARY, AUDIO_TAP_SOURCE, audioTapSwiftcArgs, audioTapTargets, buildAudioTap,
} from '../../scripts/lib/audio-tap-build.mjs';

let root: string;
const run = vi.fn((_file: string, args: string[]) => {
  const flag = args.includes('-output') ? '-output' : '-o';
  fs.writeFileSync(args[args.indexOf(flag) + 1]!, 'binary');
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-tap-build-'));
  fs.mkdirSync(path.join(root, path.dirname(AUDIO_TAP_SOURCE)), { recursive: true });
  fs.writeFileSync(path.join(root, AUDIO_TAP_SOURCE), 'print("tap")');
  run.mockClear();
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const build = (arch = 'arm64', platform = 'darwin') => buildAudioTap({ root, platform, arch, run, log: () => {} });

describe('audio-tap build (#2731)', () => {
  it('targets macOS 14.2, the first with process taps, per arch', () => {
    expect(audioTapTargets('arm64')).toEqual(['arm64-apple-macos14.2']);
    expect(audioTapTargets('x64')).toEqual(['x86_64-apple-macos14.2']);
    expect(audioTapTargets('universal')).toEqual(['arm64-apple-macos14.2', 'x86_64-apple-macos14.2']);
    expect(audioTapTargets('ia32')).toBeNull();
    expect(audioTapSwiftcArgs({ source: 's.swift', out: 'o', target: 't' }))
      .toEqual(['swiftc', '-O', '-swift-version', '5', '-target', 't', 's.swift', '-o', 'o']);
  });

  it('builds into resources/bin, then skips while source and arch are unchanged', () => {
    expect(build()).toBe('built');
    expect(run).toHaveBeenCalledWith('xcrun', expect.arrayContaining(['-target', 'arm64-apple-macos14.2']), { stdio: 'inherit' });
    expect(fs.existsSync(path.join(root, AUDIO_TAP_BINARY))).toBe(true);
    expect(build()).toBe('current');
    expect(run).toHaveBeenCalledOnce();
  });

  it('rebuilds for a changed source, another arch, or a missing binary — not for a touched file', () => {
    build();
    const src = path.join(root, AUDIO_TAP_SOURCE);
    fs.utimesSync(src, new Date(), new Date(Date.now() + 60_000));
    expect(build()).toBe('current');
    fs.writeFileSync(src, 'print("tap 2")');
    expect(build()).toBe('built');
    expect(build('x64')).toBe('built');
    fs.rmSync(path.join(root, AUDIO_TAP_BINARY));
    expect(build('x64')).toBe('built');
  });

  it('a universal build compiles both slices and joins them with lipo', () => {
    expect(build('universal')).toBe('built');
    const out = path.join(root, AUDIO_TAP_BINARY);
    expect(run.mock.calls.map(([, args]) => args[0])).toEqual(['swiftc', 'swiftc', 'lipo']);
    expect(run.mock.calls[2]![1]).toEqual(['lipo', '-create', `${out}.0`, `${out}.1`, '-output', out]);
    expect(fs.existsSync(`${out}.0`)).toBe(false);
  });

  it('does nothing off macOS, and refuses an arch it has no target for', () => {
    expect(build('x64', 'linux')).toBe('skipped');
    expect(run).not.toHaveBeenCalled();
    expect(() => build('ia32')).toThrow(/no swiftc target/);
  });

  it('a failed compile throws and records nothing', () => {
    run.mockImplementationOnce(() => { throw new Error('swiftc: error'); });
    expect(() => build()).toThrow(/swiftc: error/);
    expect(fs.existsSync(path.join(root, `${AUDIO_TAP_BINARY}.stamp`))).toBe(false);
  });
});
