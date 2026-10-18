<script lang="ts">
  /**
   * Settings → Notes → Remote images (#1332): whether this thoughtbase loads
   * images from the web, and which hosts it has been allowed. Per thoughtbase
   * and per machine, never stored in the thoughtbase.
   */
  import { onMount } from 'svelte';
  import { remoteImagesStore } from '../stores/remote-images.svelte';

  const store = remoteImagesStore;
  onMount(() => { void store.load(); });
</script>

<h3 class="settings-subsection">Remote images</h3>
<div class="field">
  <label class="choice">
    <input type="radio" name="remote-images" checked={store.policy.mode === 'ask'} onchange={() => void store.setMode('ask')} />
    Only from sites I allow
  </label>
  <label class="choice">
    <input type="radio" name="remote-images" checked={store.policy.mode === 'allow'} onchange={() => void store.setMode('allow')} />
    Always load them
  </label>
  <p class="hint">
    An image in a note that comes from the web tells that site you opened the
    note, when, and from where. Until a site is allowed, its images show as a
    placeholder you can load them from. A thoughtbase you made here loads them
    all; one you opened asks, since its notes may be someone else's. This is
    kept on this computer, not in the thoughtbase.
  </p>
  {#if store.policy.hosts.length > 0}
    <p class="hosts-label">Allowed here:</p>
    <ul class="hosts">
      {#each store.policy.hosts as host (host)}<li><code>{host}</code></li>{/each}
    </ul>
    <button type="button" onclick={() => void store.reset()}>Forget allowed sites</button>
  {/if}
</div>

<style>
  .choice { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--text); }
  .hosts-label { margin: 6px 0 2px; color: var(--text-muted); font-size: 12px; }
  .hosts { margin: 0 0 8px; padding-left: 18px; font-size: 12px; }
  button {
    align-self: flex-start;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
</style>
