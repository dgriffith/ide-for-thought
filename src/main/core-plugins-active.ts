/**
 * Which core plugins are wired up right now (#2820, #2822), as a leaf module.
 *
 * `core-plugins.ts` does the wiring and imports every subsystem it switches;
 * a reader that only needs to know whether one is on (the native menu, which
 * shows Python's kernel items only while Python is) imports this instead, so
 * it doesn't pull all of that in.
 */
const active = new Set<string>();

/** Whether a core plugin is wired up right now. */
export function isCorePluginActive(id: string): boolean {
  return active.has(id);
}

/** The core plugins wired up right now. */
export function activeCorePlugins(): string[] {
  return [...active];
}

/** Record that a core plugin was wired up or taken down. `core-plugins.ts` only. */
export function markCorePluginActive(id: string, on: boolean): void {
  if (on) active.add(id);
  else active.delete(id);
}
