/**
 * Build a per-change settings "patch" function (#1600): merge a delta into a
 * local `$state` mirror AND persist it. Shared by the settings panels whose
 * mutators were byte-identical bar their state var + setter.
 *
 *   const patchSidebar = makePatch(() => sidebar, (v) => { sidebar = v; }, setSidebarSettings);
 *   patchSidebar({ autoReveal: true }); // updates `sidebar` + persists the delta
 */
export function makePatch<T>(
  read: () => T,
  write: (value: T) => void,
  persist: (patch: Partial<T>) => void,
): (patch: Partial<T>) => void {
  return (patch: Partial<T>): void => {
    write({ ...read(), ...patch });
    persist(patch);
  };
}
