/** Types for build-warnings.mjs (#2977). */
export interface BuildWarning {
  code?: string;
  id?: string;
  loc?: { file?: string };
}

export function isKnownHarmlessWarning(warning: BuildWarning | null | undefined): boolean;

export function onwarn<W extends BuildWarning>(warning: W, warn: (warning: W) => void): void;
