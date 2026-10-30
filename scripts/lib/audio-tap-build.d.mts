/** Types for `audio-tap-build.mjs`, kept beside it so forge can import the `.mjs` untranspiled. */

export const AUDIO_TAP_SOURCE: string;
export const AUDIO_TAP_BINARY: string;
export const AUDIO_TAP_MIN_MACOS: string;
export const AUDIO_TAP_STAMP: string;

export function audioTapTargets(arch: string): string[] | null;
export function audioTapStamp(source: string | Buffer, target: string): string;
export function audioTapSwiftcArgs(opts: { source: string; out: string; target: string }): string[];
export function buildAudioTap(opts: {
  root: string;
  platform: string;
  arch: string;
  run?: (file: string, args: string[], opts: { stdio: 'inherit' }) => unknown;
  log?: (msg: string) => void;
}): 'built' | 'current' | 'skipped';
