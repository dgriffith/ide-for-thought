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
}
