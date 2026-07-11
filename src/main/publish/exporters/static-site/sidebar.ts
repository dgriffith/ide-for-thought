/**
 * Structure sidebar for the static-site exporter (#1133).
 *
 * Builds a folder/note tree for the left navigation from the EXPORTED note set —
 * NOT a raw filesystem listing — so it respects the same exclusions the pages
 * do (private / excludeTags / excludeFolders). A note that was withheld never
 * shows up as a link. Pure + string-only so the grouping is unit-testable; the
 * HTML rendering (which needs escaping) lives in render.ts.
 */

export interface SidebarNode {
  /** Folder name, or the note's display title for a leaf. */
  name: string;
  /** relativePath for a note leaf; absent for a folder. */
  path?: string;
  /** Child nodes for a folder; absent for a note leaf. */
  children?: SidebarNode[];
}

/**
 * Group notes into a nested folder tree by their relativePath segments. Each
 * level is ordered folders-first then alphabetically (by folder name / note
 * title) — the sidebar's natural reading order, matching the app's file tree.
 */
export function buildSidebarTree(notes: ReadonlyArray<{ relativePath: string; title: string }>): SidebarNode[] {
  const root: SidebarNode[] = [];
  const folders = new Map<string, SidebarNode>(); // path-prefix → folder node

  for (const note of notes) {
    const parts = note.relativePath.split('/');
    parts.pop(); // filename — the leaf's display uses the title, not the file name
    let level = root;
    let prefix = '';
    for (const folder of parts) {
      prefix = prefix ? `${prefix}/${folder}` : folder;
      let node = folders.get(prefix);
      if (!node) {
        node = { name: folder, children: [] };
        folders.set(prefix, node);
        level.push(node);
      }
      level = node.children!;
    }
    level.push({ name: note.title, path: note.relativePath });
  }

  sortLevel(root);
  return root;
}

function sortLevel(nodes: SidebarNode[]): void {
  nodes.sort((a, b) => {
    const aFolder = a.children !== undefined;
    const bFolder = b.children !== undefined;
    if (aFolder !== bFolder) return aFolder ? -1 : 1; // folders first
    return a.name.localeCompare(b.name);
  });
  for (const n of nodes) if (n.children) sortLevel(n.children);
}

/** Whether a folder subtree contains the note at `path` — used to auto-expand
 *  the ancestor folders of the current page. */
export function subtreeContains(nodes: SidebarNode[], path: string): boolean {
  return nodes.some((n) => (n.path === path) || (n.children ? subtreeContains(n.children, path) : false));
}
