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

/** The policy for one platform (default: this one). */
export function fusePolicy(platform?: string): ReadonlyArray<FusePolicyEntry>;

export function forgeFuseSettings(platform?: string): Record<number, boolean>;

export function checkFuseWire(wire: Record<string, unknown>, platform?: string): {
  ok: boolean;
  lines: string[];
  errors: string[];
};
