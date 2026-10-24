import type { PluginBlockSyntax } from '../../../shared/live-blocks';

// The live component values `createPreviewMarkdown`'s renderer rules close
// over. A leaf module (#1908) so both `markdown-config.ts` and the `install*`
// plugins it composes (`fence-plugin.ts`) can depend on the type without
// creating an import cycle between them.
export interface PreviewMarkdownDeps {
    /** Per-fence collapse state, keyed by the fence's opening source line.
     *  Shared by reference so a toggle-driven re-render reflects the change. */
    collapsedFences: Set<number>;
    /** Per-fence running state (disables the ▶ button while a cell is in
     *  flight). Shared by reference. */
    runningFences: Set<number>;
    /** The transclusion path override — set while rendering an embedded
     *  fragment so relative image paths resolve against the embedded note. */
    getRenderPathOverride: () => string | null;
    /** The note being rendered (used to resolve relative image paths). */
    getNotePath: () => string | null;
    /** Whether a runnable fence should show its ▶ button — i.e. the host wired
     *  `onRunCell` + `onApplyCellOutputEdit` and a note path is known. */
    getCanRun: () => boolean;
    /** Whether images and object-view embeds get a resize handle (#2666) —
     *  i.e. the host wired `onApplyEdit`, so a new size can be written back
     *  into the note. Absent → no handles (a read-only preview). */
    getCanResize?: () => boolean;
    /** Whether a compute language can run on this machine now (#2822): Python
     *  is a built-in plugin that can be off. Absent → every runnable one can. */
    isRunnable?: (language: string) => boolean;
    /** The plugin block a fence language or directive name is, while its
     *  plugin is on (#2641); null when it is no plugin's. Absent → none. */
    pluginBlock?: (kind: 'fence' | 'directive', name: string) => PluginBlockSyntax | null;
}
