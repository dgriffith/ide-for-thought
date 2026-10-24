<script lang="ts">
  /**
   * A plugin's live block (#2641): a fence or directive in a note, drawn by
   * the plugin's page in a frame (`PluginFrame`). Main opens its session
   * with the block's text and the note it sits in, runs its declared query,
   * and scopes it to that note plus the query's notes; this host only asks
   * for a re-run when the graph changes.
   *
   * The frame sizes to what the plugin asks (`view.setHeight`), within the
   * broker's limits; until it asks, `BLOCK_DEFAULT_HEIGHT`.
   *
   * For an export (`exportMode`), the same handshake as a plugin layout
   * (#2828): the block is sent first, then an `export` request, and the
   * plugin's answer is drawn sanitized in the frame's place, with the theme
   * tokens inline — which is what the export snapshots.
   */
  import { tick } from 'svelte';
  import PluginFrame from './PluginFrame.svelte';
  import { getGraphRevisionStore } from '../../stores/graph-revision.svelte';
  import type { PluginFrameConnection } from '../../stores/plugin-sessions.svelte';
  import { pluginExportTokens, sanitizePluginExportHtml } from '../../plugins/sanitize-plugin-export';
  import { logger } from '../../../../shared/logger';

  interface Props {
    pluginId: string;
    blockId: string;
    entry: string;
    title: string;
    notePath: string;
    source: string;
    exportMode?: boolean;
    /** For an export: drawn, or why not. */
    onExport?: { onRendered(): void; onFailed(reason: string): void };
  }

  let { pluginId, blockId, entry, title, notePath, source, exportMode = false, onExport }: Props = $props();

  /** A block's height before its plugin says. */
  const BLOCK_DEFAULT_HEIGHT = 120;

  const graph = getGraphRevisionStore();
  let connection = $state<PluginFrameConnection | null>(null);
  let height = $state(BLOCK_DEFAULT_HEIGHT);
  let wrapper = $state<HTMLDivElement | undefined>();
  const requestId = crypto.randomUUID();
  let exported = $state<string | null>(null);
  let exportTokens = $state('');

  // A live block: its query on connect, and again whenever the graph moves.
  $effect(() => {
    void graph.revision;
    if (!connection || exportMode) return;
    void connection.refreshQuery().catch((e: unknown) => logger('plugins').warn(`plugin ${pluginId}: block ${blockId} not refreshed:`, e));
  });

  function onConnected(c: PluginFrameConnection): void {
    connection = c;
    if (!exportMode) return;
    // The block first, so the plugin draws what it is asked to export.
    void c.refreshQuery()
      .then(() => c.requestExport(requestId))
      .catch((e: unknown) => onExport?.onFailed(e instanceof Error ? e.message : String(e)));
  }

  async function onExportHtml(id: string, html: string): Promise<void> {
    if (!exportMode || id !== requestId || exported !== null || !wrapper) return;
    exportTokens = pluginExportTokens(wrapper);
    exported = sanitizePluginExportHtml(html);
    await tick();
    onExport?.onRendered();
  }
</script>

{#if exported !== null}
  <div class="plugin-export" data-plugin-block={pluginId} style={exportTokens}>{@html exported}</div>
{:else}
  <div class="plugin-block-frame" data-plugin-block={pluginId} bind:this={wrapper} style:height="{height}px">
    <PluginFrame
      {pluginId}
      {entry}
      {title}
      scope={[]}
      target={{ block: blockId, notePath, source, exportMode }}
      {onConnected}
      onSetHeight={(h) => { height = h; }}
      onExportHtml={(id, html) => { void onExportHtml(id, html); }}
    />
  </div>
{/if}

<style>
  .plugin-block-frame {
    margin: 0.75em 0;
  }
</style>
