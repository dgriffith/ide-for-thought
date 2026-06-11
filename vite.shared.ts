/**
 * Shared Vite/Vitest config bits (#692).
 *
 * The `@shared` path alias was declared independently in all four configs
 * (main / preload / renderer / vitest) — harmless, but four copies that drift
 * apart. One source of truth here.
 */

/** Maps `@shared/*` imports to `src/shared/*`. */
export const sharedAlias = {
  '@shared': '/src/shared',
} as const;
