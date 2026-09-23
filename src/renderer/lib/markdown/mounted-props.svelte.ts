/**
 * Reactive props for an imperatively `mount()`ed embed (#2323).
 *
 * `mount(Component, { props })` with a plain object hands the component values
 * that never change again — Svelte 5 tracks props through the *object*, so only
 * a `$state` one propagates later writes.
 *
 * That didn't matter while `object-view-renderer` re-mounted its `TypeView` on
 * every render tick: a fresh mount with a fresh `revision` looked exactly like a
 * live prop. Preserving the mount across ticks (which is what its own module
 * header says the design intends — "`TypeView` itself still re-projects against
 * `revision` while mounted") removes that accident, so the prop has to be real
 * or a save would stop refreshing the embed.
 *
 * Runes only compile in a `.svelte.ts` module, hence this file rather than a
 * function inside the renderer.
 */

/** A `$state` props object `mount()` will track writes to. */
export function reactiveProps<T extends Record<string, unknown>>(initial: T): T {
  const props = $state(initial);
  return props;
}
