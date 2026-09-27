/**
 * Types for `electron-fuses.mjs` (#2366). Kept beside it for the same reason
 * as `package-prune.d.mts`: the implementation stays plain `.mjs` so forge's
 * loader and `scripts/*.mjs` can import it untranspiled.
 */

export interface FusePolicyEntry {
  readonly name: string;
  /** Byte offset in Electron's v1 fuse wire. */
  readonly index: number;
  readonly enabled: boolean;
}

export const FUSE_POLICY: ReadonlyArray<FusePolicyEntry>;

export function forgeFuseSettings(): Record<number, boolean>;

export function checkFuseWire(wire: Record<string, unknown>): {
  ok: boolean;
  lines: string[];
  errors: string[];
};
