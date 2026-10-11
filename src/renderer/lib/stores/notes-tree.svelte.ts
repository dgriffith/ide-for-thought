/**
 * The Notes tree's expansion state (#2626): which folders are open, and
 * whether the project's root row is. It used to live in `Sidebar.svelte`,
 * which stayed mounted while the panels switched under it, so the tree came
 * back as you left it. The Notes panel is now its own component, mounted only
 * while it's showing — so the state lives here, outliving it. Per session,
 * not saved to disk.
 */

let expanded = $state<Record<string, boolean>>({});
let rootExpanded = $state(true);

export function getNotesTreeStore() {
  return {
    /** Open folders, by relative path. Replace the record to change it. */
    get expanded() { return expanded; },
    set expanded(next: Record<string, boolean>) { expanded = next; },
    get rootExpanded() { return rootExpanded; },
    set rootExpanded(next: boolean) { rootExpanded = next; },
  };
}
