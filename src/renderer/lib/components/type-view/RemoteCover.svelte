<script lang="ts">
  /**
   * A gallery card's cover image (#1332): a cover is a URL in the note's
   * properties, so drawing it would tell that host the view was opened. Main
   * gives the bytes only when this thoughtbase may load it; otherwise the card
   * shows its type's icon, as it does with no cover, and says why on hover.
   * Allowing the host (from a note's placeholder, or Settings → Notes) redraws it.
   */
  import { api } from '../../ipc/client';
  import { remoteImagesStore } from '../../stores/remote-images.svelte';
  import { toDataUrl } from '../../preview/remote-images';
  import { logger } from '../../../../shared/logger';
  import type { Snippet } from 'svelte';

  interface Props {
    url: string;
    /** What the card shows when the image can't be drawn. */
    fallback: Snippet;
  }

  let { url, fallback }: Props = $props();
  let src = $state<string | null>(null);
  let blockedHost = $state<string | null>(null);

  $effect(() => {
    void remoteImagesStore.version;
    const u = url;
    let live = true;
    void (async () => {
      try {
        const r = await api.images.cacheExternal(u);
        if (!live) return;
        src = r.status === 'image' ? toDataUrl(r.bytes, r.mime) : null;
        blockedHost = r.status === 'blocked' ? r.host : null;
      } catch (e) {
        logger('preview').warn('cover image failed for', u, e);
      }
    })();
    return () => { live = false; };
  });
</script>

{#if src}
  <img {src} alt="" />
{:else}
  <span class="cover-fallback" title={blockedHost ? `Its image, from ${blockedHost}, isn't loaded in this thoughtbase` : undefined}>{@render fallback()}</span>
{/if}

<style>
  img { width: 100%; height: 100%; object-fit: cover; }
  .cover-fallback { display: contents; }
</style>
