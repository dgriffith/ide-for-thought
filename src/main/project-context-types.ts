/**
 * Shared type for ProjectContext (#333). The runtime registry +
 * acquire/release lifecycle will land in `./project-context.ts` once
 * graph/tables/search are all ctx-aware. This file exists to hold the
 * type so it can be imported by every module without circular deps.
 */

export interface ProjectContext {
  readonly rootPath: string;
  /** Phantom field to keep raw strings from being passed where a ctx is wanted. */
  readonly _brand: 'ProjectContext';
}

/** Helper for tests + boundary code that has only a string. */
export function projectContext(rootPath: string): ProjectContext {
  return { rootPath, _brand: 'ProjectContext' as const };
}
