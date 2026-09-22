/**
 * Types for `package-prune.mjs` (#2243).
 *
 * The implementation stays plain `.mjs` so `forge.config.ts`'s loader and the
 * `scripts/*.mjs` family can both import it without a transpile step; this
 * gives the TypeScript side real types instead of `any`, which
 * `@typescript-eslint/no-unsafe-call` correctly refuses.
 */
import type { Stats } from 'node:fs';

export function isPrunablePath(
  relativePath: string,
  options?: { isDirectory?: boolean },
): boolean;

export function makeCopyFilter(
  packageRoot: string,
  options?: {
    statSync?: (path: string) => Pick<Stats, 'isDirectory'>;
    /** Enables the package-scoped rules (see `isPrunableForPackage`). */
    packageName?: string;
  },
): (src: string) => boolean;

export function isPrunableForPackage(
  packageName: string,
  relativePath: string,
): boolean;

export function isTypesOnlyPackage(name: string): boolean;
