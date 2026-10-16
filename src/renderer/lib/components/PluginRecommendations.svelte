<script lang="ts">
  /**
   * The plugins an opened thoughtbase recommends (#2635): one card, listing
   * the ones not in use here, each with a button the user has to press.
   * Nothing installs or turns on by itself — the card reads the
   * thoughtbase's list and describes it, and Install sends the listed git URL
   * through the same channel and checks as a URL typed in Settings.
   *
   * Mounted once per open thoughtbase (App keys it on the root), so a new
   * thoughtbase is read afresh. "Not now" hides it until the thoughtbase is
   * next opened; "Don't show again" remembers these plugins for this
   * thoughtbase on this machine, and Settings → Plugins still lists them.
   */
  import { onMount } from 'svelte';
  import { getPluginsStore } from '../stores/plugins.svelte';
  import { getFeatureDialogStore } from '../stores/feature-dialogs.svelte';
  import { announce } from '../stores/announcer.svelte';
  import type { PluginRecommendation } from '../../../shared/plugins/format';

  interface Props {
    rootPath: string;
  }
  let { rootPath }: Props = $props();

  const plugins = getPluginsStore();
  const featureDialogs = getFeatureDialogStore();

  let working = $state<string | null>(null);
  let failed = $state<{ id: string; message: string } | null>(null);

  onMount(() => {
    void plugins.loadRecommendations(rootPath).then(() => {
      const n = plugins.pendingRecommendations.length;
      if (n > 0) announce(`This thoughtbase recommends ${n === 1 ? 'a plugin' : `${n} plugins`} that ${n === 1 ? "isn't" : "aren't"} in use here.`);
    });
  });

  const pending = $derived(plugins.pendingRecommendations);

  async function act(r: PluginRecommendation): Promise<void> {
    working = r.id;
    failed = null;
    try {
      if (r.status === 'disabled') {
        await plugins.setEnabled(r.id, true);
      } else if (r.installUrl) {
        await plugins.installGit(r.installUrl);
      }
      if (plugins.error) failed = { id: r.id, message: plugins.error };
    } finally {
      working = null;
    }
  }

  function openSettings(): void {
    featureDialogs.openSettings('plugins');
  }

  const label = (r: PluginRecommendation) => r.name ?? r.id;
</script>

{#if pending.length > 0}
  <section class="recs" aria-labelledby="plugin-recs-title">
    <header>
      <span class="glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7zM12 17v5" />
        </svg>
      </span>
      <div class="titles">
        <h2 id="plugin-recs-title">Recommended plugins</h2>
        <p class="sub">This thoughtbase works best with {pending.length === 1 ? 'a plugin' : 'these plugins'} you don't have in use.</p>
      </div>
      <button class="close" title="Not now" aria-label="Not now" onclick={() => plugins.hideRecommendations(pending.map((r) => r.id))}>×</button>
    </header>

    <ul>
      {#each pending as r (r.id)}
        <li>
          <div class="who">
            <span class="name">{label(r)}</span>
            {#if r.name}<code class="id">{r.id}</code>{/if}
            {#if r.status === 'disabled'}<span class="badge">Installed, turned off</span>{/if}
          </div>
          {#if r.reason}<p class="reason">{r.reason}</p>{/if}
          {#if r.types.length > 0}
            <p class="adds">Adds types: {#each r.types as t, i (t)}<code>{t}</code>{i < r.types.length - 1 ? ' ' : ''}{/each}</p>
          {/if}
          {#if r.source && r.status === 'missing'}
            <p class="source" title={r.source}>{r.source}</p>
          {/if}
          <div class="row-actions">
            {#if r.status === 'disabled'}
              <button class="primary" disabled={working !== null} onclick={() => act(r)}>{working === r.id ? 'Turning on…' : 'Turn on'}</button>
            {:else if r.installUrl}
              <button class="primary" disabled={working !== null} onclick={() => act(r)}>{working === r.id ? 'Installing…' : 'Install'}</button>
            {:else}
              <span class="manual">Get it from the address above, then install it in Settings.</span>
            {/if}
          </div>
          {#if failed?.id === r.id}<p class="error" role="alert">{failed.message}</p>{/if}
        </li>
      {/each}
    </ul>

    <footer>
      <button class="link" onclick={openSettings}>Plugins settings…</button>
      <span class="spacer"></span>
      <button class="quiet" onclick={() => plugins.dismissRecommendations(pending.map((r) => r.id))}>Don't show again</button>
      <button class="quiet" onclick={() => plugins.hideRecommendations(pending.map((r) => r.id))}>Not now</button>
    </footer>
  </section>
{/if}

<style>
  .recs {
    position: fixed;
    top: 48px;
    right: 16px;
    width: min(380px, calc(100vw - 32px));
    max-height: calc(100vh - 96px);
    display: flex;
    flex-direction: column;
    background: var(--bg-button);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    z-index: var(--z-popover);
    overflow: hidden;
    animation: recs-in 180ms ease-out;
  }
  @keyframes recs-in {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .recs { animation: none; }
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 14px 10px;
    border-bottom: 1px solid var(--border);
  }
  .glyph {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .titles { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 13px; font-weight: 600; }
  .sub { margin: 2px 0 0; font-size: 12px; color: var(--text-muted); }
  .close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 18px;
    line-height: 1;
    padding: 2px 4px;
    cursor: pointer;
  }
  .close:hover { color: var(--text); }
  ul {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
  }
  li {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li + li { border-top: 1px solid var(--border); }
  .who { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .name { font-weight: 600; font-size: 13px; }
  .id, .adds code { font-size: 11px; color: var(--text-muted); }
  .badge {
    font-size: 11px;
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .reason, .adds, .source, .manual, .error { margin: 0; font-size: 12px; }
  .reason { color: var(--text); }
  .adds, .manual { color: var(--text-muted); }
  .source {
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .error { color: var(--text); opacity: 0.9; }
  .row-actions { display: flex; margin-top: 4px; }
  .primary {
    padding: 4px 12px;
    border-radius: 6px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--bg);
    font-size: 12px;
    cursor: pointer;
  }
  .primary:disabled { opacity: 0.6; cursor: default; }
  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid var(--border);
  }
  .spacer { flex: 1; }
  .quiet, .link {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .quiet:hover, .link:hover { color: var(--text); }
  .link { color: var(--accent); }
</style>
