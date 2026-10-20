<script lang="ts">
  /**
   * A type-view layout drawn by a built-in plugin (#2828): the View API's
   * host. `TypeView` draws it like any layout, with the one `view`; this turns
   * that view into the plugin's `view` event — sent on connect and whenever
   * it changes, its instances the session's scope — and takes the plugin's
   * `view.setState` back as `view.onStateChange`, keeping only the layout's
   * own spec fields, and nothing at all in an embed or export.
   *
   * Also (#2828, part B): a card's hover preview shows the app's properties
   * strip, from the view; the plugin's `ui.showNoteMenu` opens the view's own
   * row menu; and in an export the plugin is asked for its view as static
   * HTML, which is sanitized (`sanitizePluginExportHtml`) and drawn here in
   * the frame's place — so the export's snapshot sees only sanitized markup —
   * with the export theme's tokens set inline so its `var(--…)` resolve.
   */
  import PluginFrame from './PluginFrame.svelte';
  import type { LayoutView } from '../type-view/layout-view';
  import type { PluginFrameConnection } from '../../stores/plugin-sessions.svelte';
  import { layoutDef, type ViewLayout } from '../../../../shared/objects/view-layouts';
  import type { PluginViewState } from '../../../../shared/plugins/api';
  import { logger } from '../../../../shared/logger';
  import { tick } from 'svelte';
  import { PLUGIN_THEME_TOKENS } from '../../../../shared/plugins/frame';
  import { sanitizePluginExportHtml } from '../../plugins/sanitize-plugin-export';
  import type { HoverInstance } from '../note-hover/hover-instance';

  interface Props {
    view: LayoutView;
    layout: ViewLayout;
    pluginId: string;
    /** The spec values this layout reads, as the view has them now. */
    spec: Record<string, unknown>;
  }

  let { view, layout, pluginId, spec }: Props = $props();

  let connection = $state<PluginFrameConnection | null>(null);
  let wrapper = $state<HTMLDivElement | undefined>();
  // The export (#2828): the request's id, then the sanitized answer and the
  // tokens it is drawn with.
  const requestId = crypto.randomUUID();
  let exported = $state<string | null>(null);
  let exportTokens = $state('');
  const scope = $derived(view.sorted.map((i) => i.path));

  /** The view as the plugin sees it: plain data, nothing reactive. */
  const viewState = $derived<PluginViewState>({
    layout,
    type: {
      id: view.type.id,
      label: view.type.label,
      ...(view.type.icon ? { icon: view.type.icon } : {}),
      ...(view.type.color ? { color: view.type.color } : {}),
    },
    properties: view.properties.map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.label ? { label: p.label } : {}),
      ...(p.options ? { options: [...p.options] } : {}),
    })),
    visible: view.visible ? [...view.visible] : null,
    instances: view.sorted.map((i) => ({ path: i.path, title: i.title, values: { ...i.values }, ...(i.tags ? { tags: [...i.tags] } : {}) })),
    sortColumn: view.sortColumn,
    sortDir: view.sortDir,
    spec: JSON.parse(JSON.stringify(spec)) as Record<string, unknown>,
    readOnly: view.readOnly,
    exportMode: view.exportMode,
  });

  $effect(() => {
    const next = viewState;
    if (!connection) return;
    void connection.sendView(next).catch((e: unknown) => logger('plugins').warn(`plugin ${pluginId}: view not sent:`, e));
  });

  function onConnected(c: PluginFrameConnection): void {
    connection = c;
    if (!view.exportMode) return;
    // The view first, so the plugin draws what it is asked to export.
    void c.sendView(viewState)
      .then(() => c.requestExport(requestId))
      .catch((e: unknown) => view.pluginExport?.onFailed(e instanceof Error ? e.message : String(e)));
  }

  async function onExportHtml(id: string, html: string): Promise<void> {
    if (!view.exportMode || id !== requestId || exported !== null) return;
    if (!wrapper) return;
    const style = getComputedStyle(wrapper);
    exportTokens = PLUGIN_THEME_TOKENS
      .map((t) => [t, style.getPropertyValue(t).trim()] as const)
      .filter(([, v]) => v !== '' && !/[;{}]|url\(/i.test(v))
      .map(([t, v]) => `${t}:${v}`)
      .join(';');
    exported = sanitizePluginExportHtml(html);
    await tick();
    view.pluginExport?.onRendered();
  }

  /** The app's properties strip for a card's preview: the view's own row. */
  function hoverInstance(path: string): HoverInstance | null {
    const inst = view.instances.find((i) => i.path === path);
    if (!inst) return null;
    return { type: view.type, properties: view.properties, inst, display: view.display, rowType: view.rowType(inst), visible: view.visible };
  }

  /** Only this layout's own spec fields, and only where the view can be changed. */
  function onViewState(patch: Record<string, unknown>): void {
    if (view.readOnly) return;
    const allowed = new Set(layoutDef(layout).specFields);
    const kept = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k)));
    if (Object.keys(kept).length === 0) return;
    view.onStateChange(kept);
  }
</script>

{#if exported !== null}
  <div class="plugin-export" data-plugin-layout={pluginId} style={exportTokens}>{@html exported}</div>
{:else}
  <div class="plugin-layout" data-plugin-layout={pluginId} bind:this={wrapper}>
    <PluginFrame
      {pluginId}
      {scope}
      title={`${layoutDef(layout).label} of ${view.type.label}`}
      {onConnected}
      {onViewState}
      onNoteMenu={(paths, x, y) => view.openRowMenu(paths, x, y)}
      onExportHtml={(id, html) => { void onExportHtml(id, html); }}
      {hoverInstance}
    />
  </div>
{/if}

<style>
  .plugin-layout {
    flex: 1;
    min-height: 0;
    display: flex;
  }
</style>
