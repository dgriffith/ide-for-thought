<script lang="ts">
  /**
   * A type-view layout drawn by a built-in plugin (#2828): the View API's
   * host. `TypeView` draws it like any layout, with the one `view`; this turns
   * that view into the plugin's `view` event — sent on connect and whenever
   * it changes, its instances the session's scope — and takes the plugin's
   * `view.setState` back as `view.onStateChange`, keeping only the layout's
   * own spec fields, and nothing at all in an embed or export.
   */
  import PluginFrame from './PluginFrame.svelte';
  import type { LayoutView } from '../type-view/layout-view';
  import type { PluginFrameConnection } from '../../stores/plugin-sessions.svelte';
  import { layoutDef, type ViewLayout } from '../../../../shared/objects/view-layouts';
  import type { PluginViewState } from '../../../../shared/plugins/api';
  import { logger } from '../../../../shared/logger';

  interface Props {
    view: LayoutView;
    layout: ViewLayout;
    pluginId: string;
    /** The spec values this layout reads, as the view has them now. */
    spec: Record<string, unknown>;
  }

  let { view, layout, pluginId, spec }: Props = $props();

  let connection = $state<PluginFrameConnection | null>(null);
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

  /** Only this layout's own spec fields, and only where the view can be changed. */
  function onViewState(patch: Record<string, unknown>): void {
    if (view.readOnly) return;
    const allowed = new Set(layoutDef(layout).specFields);
    const kept = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k)));
    if (Object.keys(kept).length === 0) return;
    view.onStateChange(kept);
  }
</script>

<PluginFrame
  {pluginId}
  {scope}
  title={`${layoutDef(layout).label} of ${view.type.label}`}
  onConnected={(c) => { connection = c; }}
  {onViewState}
/>
