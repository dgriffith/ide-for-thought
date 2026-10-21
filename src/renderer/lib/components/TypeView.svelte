<script lang="ts">
  import { tick, untrack } from 'svelte';
  /**
   * Multi-view over all instances of a typed-object type (#1070) — the same
   * typed notes rendered as a list, a table (declared properties as columns), a
   * gallery of cards keyed off a designated cover property, a map (#2066) or a
   * Kanban board grouped by an enum property (#2602), a timeline (#2608) or a month calendar (#2702). "Switch the view,
   * same data": every projection reads the one `api.types.instances(typeId)`
   * result, so toggling never re-queries the instance set.
   *
   * Projection state (layout / sort / visible columns) is PROP-DRIVEN: it lives
   * on the tab (persisted across sessions) and is mutated via `onStateChange`,
   * so "Save as note" (#2507) can embed it exactly in a new note.
   *
   * Rows/cards deep-link to the note; cells never mutate anything. Rows
   * multi-select (⌘/⇧-click, ⌘A) and "Edit properties (N)" hands the selection
   * to the host's bulk editor (#2431) — the view itself still writes nothing.
   */
  import { api } from '../ipc/client';
  import TypeViewLayoutSwitch from './TypeViewLayoutSwitch.svelte';
  import TypeViewFilters from './TypeViewFilters.svelte';
  import { selectionSetProperties, selectionTags, type TypeViewNoteActions } from './type-view/note-actions';
  import { notePathForIri } from '../../../shared/objects/note-iri';
  import { getNotebaseStore } from '../stores/notebase.svelte';
  import { flattenNotePaths } from '../app/text-helpers';
  import type { MapExportHooks } from '../map/map-export';
  import type { MapStyle } from '../../../shared/objects/map-style';
  import { applyViewSpec, isTypeFilter, resolveTypeFilter, type TypeLookup, type ViewFilter } from '../../../shared/objects/view-spec';
  import { subtypeChoices } from '../../../shared/objects/type-filter';
  import { buildViewEmbed } from '../../../shared/objects/view-note';
  import { comparePropertyValues, viewToCsv } from '../../../shared/objects/view-values';
  import { boardColumns, groupByForSpec, moveColumn, resolveGroupBy } from '../../../shared/objects/kanban';
  import { timelineSpecForType } from '../../../shared/objects/timeline';
  import { calendarSpecForType } from '../../../shared/objects/calendar';
  import { DEFAULT_VIEW_LAYOUT, layoutAvailable, layoutDef, layoutPlugin, layoutsFor, type ViewLayout } from '../../../shared/objects/view-layouts';
  import { corePluginsStore } from '../stores/core-plugins.svelte';
  import { LAYOUT_RENDERERS, layoutOrder } from './type-view/layout-renderers';
  import type { LayoutView, PluginExportHooks, ViewStatePatch } from './type-view/layout-view';
  import { objectTypesStore } from '../stores/object-types.svelte';
  import { effectivePropertyDefs } from '../../../shared/objects/inheritance';
  import { displayPropertyValue } from '../../../shared/objects/property-display';
  import { logger } from '../../../shared/logger';
  import { createTypeViewSelection } from './type-view-selection.svelte';
  import TypeViewRowMenu from './TypeViewRowMenu.svelte';
  import { getKanbanMoveStore } from '../stores/kanban-moves.svelte';
  import { moveTargets, sharedColumnValue, type MoveTarget } from '../../../shared/objects/kanban-move';
  import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../shared/objects/type-def';

  type Layout = ViewLayout;
  type StatePatch = ViewStatePatch;

  interface Props {
    typeId: string;
    layout: Layout;
    /** Sort key (property name, `__title`, or null) + direction — from the tab. */
    sortColumn: string | null;
    sortDir: 'asc' | 'desc';
    /** Visible property names (table); null = every declared column. */
    columns: string[] | null;
    /** Bumped by the host on write/reindex so the view re-projects (#1070). */
    revision: number;
    onStateChange: (patch: StatePatch) => void;
    onOpenNote: (relativePath: string) => void;
    /** Save the current projection as a named view (#1072); omitted when
     *  unavailable. Resolves `true` if a view was actually saved, `false` if
     *  the user cancelled the name prompt — the toolbar button only flashes
     *  its "Saved" confirmation on `true`. */
    onSaveView?: () => Promise<boolean>;
    /** Suppress the title/count/toolbar header — for an inline note embed
     *  (#2067), which has no host to mutate layout/sort/columns state and
     *  provides its own surrounding context. Defaults to the full-pane tab
     *  chrome everywhere else. */
    chromeless?: boolean;
    /** Called once the instances have loaded AND rendered into the DOM — for
     *  the export snapshot (#2510), which must not capture "Loading…". */
    onLoaded?: () => void;
    /** Only notes under this folder, recursively (#2531); null = everywhere. */
    folder?: string | null;
    /** Property filters, AND-ed (#2531). Applied in every mode — the panel, a
     *  note embed and an export all show the same filtered set. */
    filters?: ViewFilter[];
    /** Widen a folder-scoped view to the whole thoughtbase (#2532) — the
     *  "in <folder> ✕" chip. Absent (an embed, an export) → no chip. */
    onClearFolder?: () => void;
    /** Map layout only: render for an export and hand back a capture (#2511). */
    mapExport?: MapExportHooks;
    /** A plugin-drawn layout: render for an export and say when it has (#2828). */
    pluginExport?: PluginExportHooks;
    /** Map layout's tile style (#2665); `auto` follows the app theme. The
     *  panel shows a control to change it; an embed or export doesn't. */
    mapStyle?: MapStyle;
    /** Kanban's grouping enum property (#2601); null = the type's first enum.
     *  Checked against the type here, where the schema is known. */
    groupBy?: string | null;
    /** Kanban's column order and Show empty columns (#2614, `kanban.ts`). */
    columnOrder?: string[];
    showEmptyColumns?: boolean;
    /** Draw for an export snapshot: a board wraps its columns (#2604), a
     *  timeline (#2609) and a calendar (#2704) draw statically. */
    exportMode?: boolean;
    /** Timeline's visible range (#2607, `timeline.ts`); null on both = fit all. */
    from?: string | null; to?: string | null;
    /** Calendar's month page and the date property notes are placed by (#2701, `calendar.ts`); null = this month, the default. */
    month?: string | null; dateBy?: string | null;
    /** The note actions for selected rows (#2431, #2773): the bulk property
     *  panel, tags and properties. Absent (an embed, an export) → rows don't
     *  multi-select; a click just opens the note. */
    noteActions?: TypeViewNoteActions | undefined;
  }
  let { typeId, layout, sortColumn, sortDir, columns, revision, onStateChange, onOpenNote, onSaveView, chromeless = false, onLoaded, mapExport, pluginExport, folder = null, filters = [], onClearFolder, mapStyle = 'auto', groupBy = null, columnOrder = [], showEmptyColumns = true, exportMode = false, from = null, to = null, month = null, dateBy = null, noteActions }: Props = $props();

  let type = $state<TypeInfo | null>(null);
  let instances = $state<TypeInstanceRow[]>([]);
  let loading = $state(true);
  let columnsMenuOpen = $state(false);

  async function load(): Promise<void> {
    loading = untrack(() => type?.id !== typeId); // a refresh keeps the view (and a board's focus) up
    // A Type filter (#2716) is matched against the catalog — an export must not snapshot before it's known.
    if (!objectTypesStore.loaded && untrack(() => filters.some(isTypeFilter))) await objectTypesStore.refresh();
    const result = await api.types.instances(typeId);
    type = result.type;
    instances = result.instances;
    loading = false;
    if (onLoaded) { await tick(); onLoaded(); }
  }
  // Re-project when the type changes or the graph is rewritten.
  const moves = getKanbanMoveStore(); // a card move (#2603) re-projects too
  $effect(() => { typeId; revision; moves.revision; void load(); });

  // Effective (inherited + own) properties, not just `type.properties` —
  // otherwise a subtype relying on an ancestor's property (e.g. a `geo`
  // location inherited from Place) loses that column entirely, and with it
  // the Map layout option below, which is gated on a geo property existing
  // at all. The freshly-loaded `type` is spread in last (after the store's
  // catalog) so the current type is always present and authoritative for
  // the chain walk even if the store's own copy is stale or hasn't loaded
  // yet — the store is only needed here to resolve ANCESTOR ids.
  const allColumns = $derived<PropertyDef[]>(
    type
      ? effectivePropertyDefs(
          type.id,
          new Map<string, TypeInfo>([...objectTypesStore.types.map((t) => [t.id, t] as const), [type.id, type]]),
        )
      : [],
  );
  // A `timeline` (#2607, #2715) or `calendar` (#2701) spec for a type with no
  // date property reads back as the default layout; kept as written until the type loads.
  const catalog = $derived(type ? [...objectTypesStore.types, type] : null);
  const timelineSpec = $derived(timelineSpecForType({ layout, from, to, dateBy }, typeId, catalog));
  const calendarSpec = $derived(calendarSpecForType({ layout: timelineSpec.layout, month, dateBy }, typeId, catalog));
  // A layout a built-in plugin draws shows the table while the plugin is off
  // (#2828); the view keeps its layout, so turning the plugin on brings it back.
  const wanted = $derived<Layout>(calendarSpec.layout);
  const offPlugin = $derived(layoutAvailable(wanted, (id) => corePluginsStore.isOn(id)) ? null : layoutPlugin(wanted));
  const shown = $derived<Layout>(offPlugin ? DEFAULT_VIEW_LAYOUT : wanted);
  // The layouts this type can show, from the registry (#2623).
  const available = $derived(layoutsFor({ typeId, properties: allColumns, catalog: catalog ?? objectTypesStore.types, pluginOn: (id) => corePluginsStore.isOn(id) }));
  // Visible columns (table): null on the tab means "all". Order follows the
  // type's declared order regardless of the saved set.
  const visibleColumns = $derived<PropertyDef[]>(
    columns === null ? allColumns : allColumns.filter((c) => columns.includes(c.name)),
  );

  function isVisible(name: string): boolean {
    return columns === null || columns.includes(name);
  }
  function toggleColumn(name: string): void {
    const all = allColumns.map((c) => c.name);
    const cur = new Set(columns ?? all);
    if (cur.has(name)) cur.delete(name); else cur.add(name);
    const next = all.filter((n) => cur.has(n));
    onStateChange({ columns: next.length === all.length ? null : next });
  }

  // A link: its note's name, or plain text as written (#2612). A datetime: locale-formatted (#2613).
  const display = displayPropertyValue;

  function summary(inst: TypeInstanceRow): string {
    for (const col of allColumns) {
      const v = inst.values[col.name];
      if (v) return `${col.label ?? col.name}: ${display(col, v)}`;
    }
    return '';
  }

  function toggleSort(col: string): void {
    if (sortColumn === col) onStateChange({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' });
    else onStateChange({ sortColumn: col, sortDir: 'asc' });
  }

  function cellFor(inst: TypeInstanceRow, col: string): string | null {
    return col === '__title' ? inst.title : inst.values[col] ?? null;
  }

  /** The folder's instances before filtering — what the filter controls offer
   *  values from (#2533), so ticking one value doesn't hide the others. */
  const inFolderOnly = $derived<TypeInstanceRow[]>(applyViewSpec(instances, { folder }));

  /** What this view shows (#2531): the type's instances in `folder`, through
   *  `filters` — the one rule the panel, embeds and exports share. */
  const propertyTypes = $derived(Object.fromEntries(allColumns.map((c) => [c.name, c.type])));
  // The Type filter (#2716, `view-spec.ts`): the catalog and each note's own
  // type once the store has them; stale ids dropped, choices counted in scope.
  const typeLookup = $derived<TypeLookup | null>(catalog && objectTypesStore.loaded
    ? { byId: new Map(catalog.map((t) => [t.id, t] as const)), typeOf: (p) => objectTypesStore.typeForNote(p)?.id } : null);
  const viewFilters = $derived(resolveTypeFilter(filters, typeId, typeLookup?.byId ?? null));
  const subtypes = $derived(typeLookup && catalog && !chromeless
    ? subtypeChoices(typeId, catalog, applyViewSpec(instances, { folder, filters: viewFilters.filter((f) => !isTypeFilter(f)) }, propertyTypes), typeLookup.typeOf) : []);
  const scoped = $derived<TypeInstanceRow[]>(applyViewSpec(instances, { folder, filters: viewFilters }, propertyTypes, typeLookup));

  function emptyScopedMessage(label: string): string {
    const what = label.toLowerCase();
    if (viewFilters.length > 0) return folder ? `No ${what} in ${folder} match these filters.` : `No ${what} match these filters.`;
    return `No ${what} in ${folder}.`;
  }

  const sorted = $derived.by<TypeInstanceRow[]>(() => {
    if (!sortColumn) return scoped;
    const col = sortColumn;
    const colType = col === '__title' ? undefined : allColumns.find((c) => c.name === col)?.type;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...scoped].sort((a, b) => {
      const av = cellFor(a, col);
      const bv = cellFor(b, col);
      if (av === null || av === '') return bv === null || bv === '' ? 0 : 1;
      if (bv === null || bv === '') return -1;
      return comparePropertyValues(colType, av, bv) * dir;
    });
  });

  let markdownCopied = $state(false);
  let viewSaved = $state(false);

  /**
   * "Copy as markdown" copies the view's live embed — the same ```object-view
   * block Save as note writes (`buildViewEmbed`), with this view's layout,
   * sort, columns, folder and filters — so pasting it into any note shows
   * exactly this view, kept current. It used to copy a snapshot (a markdown
   * table, or a bullet list for every other layout), which pasted as
   * something else entirely: a map came out as a list.
   *
   * A stateless OS side-effect (`navigator.clipboard`), so it's called
   * directly rather than routed through a store per CLAUDE.md's renderer
   * data-flow rule. Awaits the write and flashes the button label to
   * "Copied" on success — a clipboard write has no other visible effect, so
   * with no feedback a real success is indistinguishable from a silent
   * failure (report: "does not appear to do anything").
   */
  async function copyAsMarkdown(): Promise<void> {
    // A `groupBy` the type no longer has as an enum is dropped, not copied.
    const md = buildViewEmbed({ typeId, ...timelineSpec, ...calendarSpec, sortColumn, sortDir, columns, folder, filters: viewFilters, mapStyle, groupBy: groupByForSpec(groupBy, type ? allColumns : null), columnOrder, showEmptyColumns });
    try {
      await navigator.clipboard.writeText(md);
      markdownCopied = true;
      setTimeout(() => { markdownCopied = false; }, 1500);
    } catch (e) {
      logger('objects').error('copy as markdown failed:', e);
    }
  }

  /** Export CSV (#2613): this view's rows, in the order its layout draws them, and columns; ISO values. A stateless OS side-effect. */
  function exportCsv(): void {
    void api.export.csv(viewToCsv(visibleColumns, layoutOrder(shown, view)));
  }

  /** Save-view confirmation (#1072) — same "flash the button label" pattern
   *  as copyAsMarkdown above, and for the same reason: `onSaveView` succeeds
   *  silently (no toast, per CLAUDE.md's UI philosophy), so a real save was
   *  indistinguishable from the user cancelling the name prompt (report:
   *  "pops up a note name box, which then does nothing" — it wasn't doing
   *  nothing, saving one just looked identical to cancelling one). */
  async function handleSaveViewClick(): Promise<void> {
    if (!onSaveView) return;
    const saved = await onSaveView();
    if (saved) {
      viewSaved = true;
      setTimeout(() => { viewSaved = false; }, 1500);
    }
  }

  // Multi-select (#2431): ⌘/⇧-click, ⌘A, Escape, right-click — the sidebar's semantics.
  const selectable = $derived(!!noteActions && !chromeless);
  const notebase = getNotebaseStore();
  // Notes a link value can name (#2775), to map its IRI back to a path.
  const knownNotePaths = $derived(new Set(flattenNotePaths(notebase.files)));
  let refLabel = $state('');
  // An embed with note actions (#2774): the menu for one note, no multi-select —
  // and no Move to ▸, since an embedded board stays read-only (#2604).
  const menuOnly = $derived(!!noteActions && chromeless && !exportMode);
  const sel = createTypeViewSelection({
    order: () => layoutOrder(shown, view).map((i) => i.path),
    enabled: () => selectable,
    menuOnly: () => menuOnly,
    onOpen: (p) => onOpenNote(p),
    onEdit: (paths) => noteActions?.editProperties(paths),
  });

  /** The row menu's note actions (#2773): each closes the menu, then hands the
   *  selection to the host, which owns the writes. */
  function noteMenu(actions: TypeViewNoteActions, paths: string[]) {
    const run = (fn: () => void) => { sel.closeMenu(); fn(); };
    const target = sel.menu?.target;
    // A note named inside a row (#2775): prompt-based actions, since the view
    // doesn't hold that note's tags or fields — the panel covers set and clear.
    if (target) {
      return {
        heading: refLabel,
        onAddTag: () => run(() => actions.addTag([target])),
        onRemoveTagPrompt: () => run(() => actions.removeTag([target])),
      };
    }
    return {
      onAddTag: () => run(() => actions.addTag(paths)),
      removeTags: selectionTags(instances, paths),
      onRemoveTag: (tag: string) => run(() => actions.removeTag(paths, tag)),
      setProperties: allColumns.map((p) => ({ key: p.name, label: p.label ?? p.name, count: 0 })),
      onSetProperty: (name: string) => run(() => actions.editProperties(paths, name)),
      clearProperties: selectionSetProperties(instances, paths, allColumns),
      onClearProperty: (name: string) => run(() => actions.clearProperty(paths, name)),
    };
  }

  /**
   * The icon for one row. This view is subclass-aware (#1587) — a Book view
   * lists Novels too — so a row shows its OWN type's icon, not the view's.
   * That makes the per-row icon informative rather than merely repeating the
   * header. Falls back to the view's type if the map hasn't loaded yet.
   */
  function rowType(inst: TypeInstanceRow): TypeInfo | null {
    return objectTypesStore.typeForNote(inst.path) ?? type;
  }

  // The switcher offers Map / Kanban only where they can draw (#2066, #2602).
  const locationProperty = $derived<string | null>(allColumns.find((c) => c.type === 'geo')?.name ?? null);
  // Kanban (#2602): the grouping enum, then the columns — sorted cards, the
  // values filter on that property narrowing the columns (`boardColumns`).
  const groupProp = $derived(resolveGroupBy(groupBy, allColumns));
  const board = $derived(groupProp ? boardColumns(sorted, groupProp, viewFilters, { columnOrder, showEmptyColumns }) : []);
  function moveTo(paths: string[], target: MoveTarget): void {
    sel.closeMenu();
    const cards = paths.map((p) => ({ path: p, title: instances.find((i) => i.path === p)?.title ?? p }));
    if (groupProp && cards.length > 0) void moves.moveCards(cards, groupProp.name, target);
  }
  function onMoveColumn(key: string, target: string, side: 'before' | 'after'): void {
    if (groupProp) onStateChange({ columnOrder: moveColumn(instances, groupProp, columnOrder, key, target, side) });
  }

  // What every layout is drawn from (#2623) — one object of getters, so its
  // identity never changes and a layout re-renders only on what it reads
  // (see `type-view/layout-view.ts`). `type` is non-null wherever a layout
  // is drawn: the template shows a message instead while it's missing.
  const view: LayoutView = {
    get type() { return type!; },
    get properties() { return allColumns; },
    get visibleColumns() { return visibleColumns; },
    get visible() { return columns; },
    get instances() { return scoped; },
    get sorted() { return sorted; },
    get sortColumn() { return sortColumn; },
    get sortDir() { return sortDir; },
    toggleSort,
    get filters() { return viewFilters; },
    display,
    rowType,
    summary,
    get selectable() { return selectable; },
    get rowMenu() { return selectable || menuOnly; },
    isSelected: (p) => sel.has(p),
    onRowClick: (e, p) => sel.click(e, p),
    onRowContextMenu: (e, p) => sel.contextMenu(e, p),
    refPath: (prop, value) => (noteActions && prop.type === 'link-to-type' && value ? notePathForIri(value, knownNotePaths) : null),
    onRefContextMenu: (e, p, label) => { refLabel = label; sel.contextMenuFor(e, p); },
    openRowMenu: (paths, x, y) => sel.openMenuFor(paths, x, y),
    selectAll: () => sel.selectAll(),
    clearSelection: () => sel.clear(),
    onOpenNote: (p) => onOpenNote(p),
    onStateChange: (p) => onStateChange(p),
    get readOnly() { return chromeless; },
    get exportMode() { return exportMode; },
    get locationProperty() { return locationProperty; },
    get mapStyle() { return mapStyle; },
    get mapExport() { return mapExport; },
    get pluginExport() { return pluginExport; },
    get group() { return groupProp; },
    get board() { return board; },
    get onMoveCard() { return selectable ? (p: string, t: MoveTarget) => moveTo([p], t) : undefined; },
    get onUndoMove() { return selectable ? () => void moves.undoLastMove() : undefined; },
    get onMoveColumn() { return chromeless ? undefined : onMoveColumn; },
    get from() { return timelineSpec.from; },
    get to() { return timelineSpec.to; },
    get month() { return calendarSpec.month; },
    get dateBy() { return calendarSpec.dateBy; },
  };
  const renderer = $derived(LAYOUT_RENDERERS[shown]);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="type-view" onkeydown={sel.keydown}>
  {#if !chromeless}
    <header class="tv-header">
      <span class="tv-icon" style={type?.color ? `color:${type.color}` : undefined}>{type?.icon ?? '◆'}</span>
      <h1 class="tv-title">{type?.label ?? typeId}</h1>
      <span class="tv-count">{scoped.length === instances.length ? scoped.length : `${scoped.length} of ${instances.length}`}</span>
      {#if folder && onClearFolder}
        <span class="tv-chip" title="Only notes under {folder}">
          in {folder}
          <button type="button" class="tv-chip-x" aria-label="Show {type?.label ?? typeId} from the whole thoughtbase" onclick={onClearFolder}>✕</button>
        </span>
      {/if}
      <TypeViewFilters properties={allColumns} instances={inFolderOnly} filters={viewFilters} {subtypes} {display} onChange={(next) => onStateChange({ filters: next })} />

      <div class="tv-actions">
        {#if selectable && sel.selectedPaths.length > 0}
          <button class="tv-btn tv-edit" onclick={sel.editSelected} title="Edit the selected notes' properties together">
            Edit properties ({sel.selectedPaths.length})
          </button>
        {/if}
        {#if renderer.columnPicker && allColumns.length > 0}
          <div class="tv-columns">
            <button class="tv-btn" aria-expanded={columnsMenuOpen} onclick={() => (columnsMenuOpen = !columnsMenuOpen)}>Columns ▾</button>
            {#if columnsMenuOpen}
              <div class="tv-columns-menu" role="menu">
                {#each allColumns as col (col.name)}
                  <label>
                    <input type="checkbox" checked={isVisible(col.name)} onchange={() => toggleColumn(col.name)} />
                    {col.label ?? col.name}
                  </label>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        <button class="tv-btn" onclick={copyAsMarkdown}>{markdownCopied ? 'Copied' : 'Copy as markdown'}</button>
        <button class="tv-btn" onclick={exportCsv} title="Save the notes this view shows, with their properties, as a CSV file">Export CSV</button>
        {#if onSaveView}
          <button class="tv-btn" onclick={handleSaveViewClick} title="Save this view as a note, with the view embedded live">{viewSaved ? 'Saved' : 'Save as note'}</button>
        {/if}
        <TypeViewLayoutSwitch layout={shown} layouts={available} properties={allColumns} {groupBy} dateBy={timelineSpec.dateBy} {showEmptyColumns} {onStateChange} />
      </div>
    </header>
  {/if}

  {#if loading}
    <p class="tv-empty">Loading…</p>
  {:else if !type}
    <p class="tv-empty">This type is no longer defined.</p>
  {:else if instances.length === 0}
    <p class="tv-empty">No {type.label.toLowerCase()} instances yet.</p>
  {:else if scoped.length === 0}
    <p class="tv-empty">{emptyScopedMessage(type.label)}</p>
  {:else}
    {#if offPlugin}
      <p class="tv-layout-off">{layoutDef(wanted).label} is turned off on this machine. Turn on {corePluginsStore.name(offPlugin)} in Settings → Plugins to see this view that way.</p>
    {/if}
    <renderer.component {view} />
{/if}

  {#if sel.menu}
    <TypeViewRowMenu
      x={sel.menu.x} y={sel.menu.y} count={sel.menu.target ? 1 : sel.selectedPaths.length} onEdit={sel.editSelected} onClose={sel.closeMenu}
      {...(noteActions ? noteMenu(noteActions, sel.selectedPaths) : {})}
      {...(renderer.rowMenuMove && groupProp && selectable && !sel.menu.target ? { moveTargets: moveTargets(groupProp, board), moveFrom: sharedColumnValue(board, sel.selectedPaths), onMove: (t: MoveTarget) => moveTo(sel.selectedPaths, t) } : {})}
    />
  {/if}
</div>

<style>
  .type-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .tv-layout-off { margin: 8px 16px 0; color: var(--text-muted); font-size: 12px; }
  .tv-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .tv-icon { font-size: 18px; line-height: 1; }
  .tv-title { font-size: 15px; font-weight: 600; margin: 0; color: var(--text); }
  .tv-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .tv-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .tv-btn {
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-button);
    color: var(--text-muted);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .tv-btn:hover { color: var(--text); border-color: var(--accent); }
  .tv-columns { position: relative; }
  .tv-columns-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 150px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-elevated, var(--bg));
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }
  .tv-columns-menu label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    border-radius: 4px;
  }
  .tv-columns-menu label:hover { background: color-mix(in oklch, var(--text) 5%, transparent); }
  /* :global — a layout's own fallback message (MapLayout's) wears it too. */
  .type-view :global(.tv-empty) { padding: 24px 16px; color: var(--text-faint); font-size: 13px; }

  .tv-edit { color: var(--text); border-color: var(--accent); }
  /* Folder scope chip (#2532). */
  .tv-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px 1px 8px; border-radius: 999px; background: var(--bg-button); color: var(--text-muted); font-size: 11.5px; white-space: nowrap; }
  .tv-chip-x { border: none; background: transparent; color: var(--text-muted); cursor: pointer; padding: 0 4px; border-radius: 999px; font-size: 10px; line-height: 1.6; }
  .tv-chip-x:hover { color: var(--text); background: color-mix(in oklch, var(--text) 8%, transparent); }
</style>
