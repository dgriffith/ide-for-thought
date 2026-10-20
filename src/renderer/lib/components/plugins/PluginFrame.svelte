<script lang="ts">
  /**
   * The one host for a plugin's view (#2827): kanban (#2828), and later panels
   * and blocks. It frames the plugin on its own origin with
   * `PLUGIN_FRAME_SANDBOX` (#2824), connects it to a session over the notes
   * in `scope` (#2825), and does across the frame boundary what an in-page
   * component would get for free:
   *
   * - **theme**: the app's tokens are sent on connect and again whenever the
   *   theme changes (a `data-theme` switch, or a plugin theme's stylesheet);
   * - **focus**: Escape inside the frame gives focus back to this host;
   * - **drops**: while any drag is on, the frame ignores the pointer, so a
   *   note dragged from the sidebar (HTML5) or a panel (pointer, `link-drag`)
   *   lands here, and is sent to the plugin — joining its scope — in the
   *   frame's own coordinates.
   */
  import { onDestroy } from 'svelte';
  import { PLUGIN_FRAME_SANDBOX, PLUGIN_THEME_TOKENS, pluginFrameOrigin } from '../../../../shared/plugins/frame';
  import { connectPluginFrame, type PluginFrameConnection } from '../../stores/plugin-sessions.svelte';
  import { NOTE_DROP_EVENT, type NoteDropDetail } from '../../stores/link-drag.svelte';
  import { DRAG_MIME_NOTE } from '../../editor/drag-link';
  import { logger } from '../../../../shared/logger';

  interface Props {
    pluginId: string;
    /** The page in the plugin's folder to show. */
    entry?: string;
    /** The notes this view is given. */
    scope: string[];
    /** The frame's accessible name. */
    title: string;
    /** Connected: what a layout host (`PluginLayout`) builds on (#2828). */
    onConnected?: (connection: PluginFrameConnection) => void;
    /** The plugin asked to change its view's spec (#2828). */
    onViewState?: (patch: Record<string, unknown>) => void;
  }

  let { pluginId, entry = 'index.html', scope, title, onConnected, onViewState }: Props = $props();

  let host: HTMLDivElement;
  // Inside the {#if}, so bound reactively.
  let frame = $state<HTMLIFrameElement | undefined>();
  let connection: PluginFrameConnection | null = null;
  let failed = $state<string | null>(null);
  let dragging = $state(false);
  let lastScope = '';

  /** The app's theme tokens as they are now. */
  function currentTheme(): { mode: string; vars: Record<string, string> } {
    const style = getComputedStyle(document.documentElement);
    const vars: Record<string, string> = {};
    for (const token of PLUGIN_THEME_TOKENS) {
      const value = style.getPropertyValue(token).trim();
      if (value) vars[token] = value;
    }
    return { mode: document.documentElement.dataset.theme ?? 'dark', vars };
  }

  function sendTheme(): void {
    const { mode, vars } = currentTheme();
    void connection?.sendTheme(mode, vars).catch((e: unknown) => logger('plugins').warn(`plugin ${pluginId}: theme not sent:`, e));
  }

  async function onLoad(): Promise<void> {
    if (connection || !frame) return;
    try {
      connection = await connectPluginFrame(frame, pluginId, [...scope], {
        releaseFocus: () => host.focus(),
        setViewState: (patch) => onViewState?.(patch),
      });
      lastScope = JSON.stringify(scope);
      sendTheme();
      onConnected?.(connection);
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    }
  }

  // The theme moves by an attribute on <html> or a stylesheet in <head>.
  const observer = new MutationObserver(() => sendTheme());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-theme-base', 'style'] });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });

  // A pointer drag (`link-drag`) ending here arrives as a custom event.
  $effect(() => {
    host.addEventListener(NOTE_DROP_EVENT, onNoteDrop);
    return () => host.removeEventListener(NOTE_DROP_EVENT, onNoteDrop);
  });

  $effect(() => {
    const next = JSON.stringify(scope);
    if (connection && next !== lastScope) {
      lastScope = next;
      void connection.setScope([...scope]);
    }
  });

  function dropAt(paths: string[], clientX: number, clientY: number): void {
    if (!connection || !frame || paths.length === 0) return;
    const rect = frame.getBoundingClientRect();
    void connection.drop(paths, Math.round(clientX - rect.left), Math.round(clientY - rect.top));
  }

  function onNoteDrop(e: Event): void {
    const { paths, clientX, clientY } = (e as CustomEvent<NoteDropDetail>).detail;
    dropAt(paths, clientX, clientY);
  }

  // An HTML5 drag anywhere (the file tree's) makes the frame ignore the pointer.
  const onDragStart = () => { dragging = true; };
  const onDragEnd = () => { dragging = false; };
  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('dragend', onDragEnd, true);
  document.addEventListener('drop', onDragEnd, true);

  function onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes(DRAG_MIME_NOTE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(e: DragEvent): void {
    const path = e.dataTransfer?.getData(DRAG_MIME_NOTE);
    dragging = false;
    if (!path) return;
    e.preventDefault();
    dropAt([path], e.clientX, e.clientY);
  }

  onDestroy(() => {
    observer.disconnect();
    document.removeEventListener('dragstart', onDragStart, true);
    document.removeEventListener('dragend', onDragEnd, true);
    document.removeEventListener('drop', onDragEnd, true);
    void connection?.close();
    connection = null;
  });
</script>

<div
  class="plugin-frame"
  class:dragging
  bind:this={host}
  tabindex="-1"
  data-note-drop-target
  data-plugin-id={pluginId}
  role="group"
  aria-label={title}
  ondragover={onDragOver}
  ondrop={onDrop}
>
  {#if failed}
    <p class="plugin-frame-failed">This view couldn't start: {failed}</p>
  {:else}
    <iframe
      bind:this={frame}
      src={`${pluginFrameOrigin(pluginId)}/${entry}`}
      sandbox={PLUGIN_FRAME_SANDBOX}
      {title}
      onload={() => { void onLoad(); }}
    ></iframe>
  {/if}
</div>

<style>
  .plugin-frame {
    position: relative;
    width: 100%;
    height: 100%;
    outline: none;
  }
  .plugin-frame:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: var(--bg);
  }
  /* While a drag is on, the drop lands on this host, not inside the frame. */
  .plugin-frame.dragging iframe,
  :global(body.link-dragging) .plugin-frame iframe {
    pointer-events: none;
  }
  .plugin-frame-failed {
    margin: 12px;
    color: var(--text-muted);
  }
</style>
