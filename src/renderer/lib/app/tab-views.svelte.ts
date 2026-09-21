/**
 * The per-group mounted view instances, as one structure instead of four
 * parallel maps (#2236 PR 2/2, epic #2241).
 *
 * App.svelte carried four `Record<string, Component | undefined>` maps —
 * `editorComponents`, `previewComponents`, `queryPanelComponents`,
 * `neighborhoodGraphComponents` — each keyed by editor-group id, each with its
 * own `$state` declaration and its own `$derived` accessor for the focused
 * group. The `Tab` union has seven members, so a new view kind meant a fifth
 * parallel map, a fifth accessor, and remembering every place the other four
 * are iterated.
 *
 * ── Why slots rather than the Tab union ─────────────────────────────────────
 * #2236 suggests keying one map by the `Tab` union's `type`. That doesn't fit:
 * in `editor-preview` view mode a single group mounts an Editor AND a Preview
 * at once (see App's run-all-cells button, which prefers the editor and falls
 * back to the preview). So a group doesn't have *a* view, it has a set of
 * optional slots — which is what this models.
 *
 * ── What it actually buys ───────────────────────────────────────────────────
 * Honestly: not many lines. The real win is `themedViews` below. Re-skinning
 * on a theme change was four hand-written `?.updateTheme()` calls in App, and
 * nothing connected them — add a fifth view kind, forget the fifth call, and
 * the new pane silently keeps the old theme until it remounts. That is the
 * class of bug a fifth parallel map invites, and it's the one this removes.
 */
import type Editor from '../components/Editor.svelte';
import type Preview from '../components/Preview.svelte';
import type QueryPanel from '../components/QueryPanel.svelte';
import type NeighborhoodGraph from '../components/NeighborhoodGraph.svelte';

/**
 * What every mounted view can do, whatever kind it is. Structural on purpose:
 * a new view kind joins by having the method, not by being registered.
 *
 * It is also the only way this module can say so. `tsc` type-checks `.ts`
 * files without the Svelte compiler, so a `*.svelte` default import is the
 * generic `SvelteComponent` here — `updateTheme` is invisible to it, even
 * though svelte-check resolves the real class at App's call sites. Declaring
 * the method structurally and intersecting it into the slots below (the same
 * move `ipc-wiring.ts` makes with `EditorRef`) satisfies both checkers without
 * a cast: `tsc` learns the method exists, svelte-check verifies that the
 * concrete components really do have it.
 */
export interface ThemedView {
  updateTheme(): void;
}

/**
 * Mounted instances per editor group, one keyed map per view kind.
 *
 * Still a map per kind rather than one map of records because `bind:this`
 * needs an assignable slot: `bind:this={views.editor[groupId]}` works against
 * an always-present `views.editor`, where `views[groupId].editor` would need
 * the per-group object to exist before the pane mounts.
 */
export type TabViews = {
  editor: Record<string, (Editor & ThemedView) | undefined>;
  preview: Record<string, (Preview & ThemedView) | undefined>;
  query: Record<string, (QueryPanel & ThemedView) | undefined>;
  graph: Record<string, (NeighborhoodGraph & ThemedView) | undefined>;
};

export function createTabViews(): TabViews {
  return { editor: {}, preview: {}, query: {}, graph: {} };
}

/**
 * Every mounted view across every group, for operations that must reach all of
 * them. Iterating the structure is what makes "did you remember the new kind?"
 * unanswerable-by-forgetting: a kind added to `TabViews` is included here for
 * free, because this walks the object's values rather than a hand-kept list.
 */
export function allViews(views: TabViews): ThemedView[] {
  // `TabViews` is a type alias and not an interface precisely so this line
  // types: only an alias gets the implicit index signature `Object.values<T>`
  // needs. Without it the call resolves to the `any[]` overload instead, and
  // the `.filter` predicate below becomes an unchecked assertion.
  return Object.values<Record<string, ThemedView | undefined>>(views)
    .flatMap((byGroup) => Object.values(byGroup))
    .filter((v): v is ThemedView => v !== undefined);
}

/** Re-skin every mounted pane after a theme change. */
export function updateThemeAll(views: TabViews): void {
  for (const view of allViews(views)) view.updateTheme();
}

/** Every mounted Editor, for the operations that are editor-specific (font
 *  size, which CodeMirror owns). Typed narrowly so callers don't re-filter. */
export function allEditors(views: TabViews): (Editor & ThemedView)[] {
  return Object.values(views.editor).filter((e) => e !== undefined);
}
