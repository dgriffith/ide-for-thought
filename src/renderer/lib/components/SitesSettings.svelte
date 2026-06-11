<script lang="ts">
  /**
   * Privileged-sites settings panel (extracted from SettingsDialog for #672).
   *
   * Self-contained: it owns the site list + the add-form fields, loads on
   * mount, and drives everything through `api.sites.*`. Used to route ingest
   * fetches for domains the user has a login for (institutional / paid access)
   * through the in-app browser session. The dialog just mounts it for the
   * "sites" tab.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import type { PrivilegedSite } from '../../../shared/types';

  let sites = $state<PrivilegedSite[]>([]);
  let newSiteDomain = $state('');
  let newSiteLabel = $state('');
  let siteBusyId = $state<string | null>(null);

  async function reloadSites(): Promise<void> {
    try {
      sites = await api.sites.list();
    } catch (e) {
      console.error('[settings] failed to load sites:', e);
    }
  }

  async function addSite(): Promise<void> {
    const domain = newSiteDomain.trim();
    if (!domain) return;
    try {
      await api.sites.add(domain, newSiteLabel.trim() || undefined);
      newSiteDomain = '';
      newSiteLabel = '';
      await reloadSites();
    } catch (e) {
      console.error('[settings] addSite failed:', e);
    }
  }

  async function loginSite(id: string): Promise<void> {
    siteBusyId = id;
    try {
      await api.sites.login(id);
      await reloadSites();
    } finally {
      siteBusyId = null;
    }
  }

  async function logoutSite(id: string): Promise<void> {
    await api.sites.logout(id);
    await reloadSites();
  }

  async function removeSite(id: string): Promise<void> {
    await api.sites.remove(id);
    await reloadSites();
  }

  function formatLastLogin(iso: string | null): string {
    if (!iso) return 'never';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  onMount(reloadSites);
</script>

<div class="field">
  <p class="hint">
    Add sites you have a login for (institutional access, paid
    subscriptions, etc.). Minerva will route ingest fetches to those
    domains through your in-app browser session, so the response
    reflects what you can see when logged in.
  </p>
</div>
<div class="field">
  <label for="new-site-domain">Add site</label>
  <div class="site-add-row">
    <input
      id="new-site-domain"
      type="text"
      bind:value={newSiteDomain}
      placeholder="arxiv.org"
    />
    <input
      type="text"
      bind:value={newSiteLabel}
      placeholder="Label (optional)"
    />
    <button onclick={addSite} disabled={!newSiteDomain.trim()}>Add</button>
  </div>
</div>
<div class="field">
  {#if sites.length === 0}
    <p class="hint">No sites configured.</p>
  {:else}
    <ul class="sites-list">
      {#each sites as site (site.id)}
        <li class="site-row">
          <div class="site-info">
            <div class="site-label">{site.label}</div>
            <div class="site-meta">
              {site.domain} · last login: {formatLastLogin(site.lastLoginAt)}
            </div>
          </div>
          <div class="site-actions">
            <button
              onclick={() => loginSite(site.id)}
              disabled={siteBusyId === site.id}
              title="Open a browser window for this domain so you can log in"
            >Login</button>
            <button
              onclick={() => logoutSite(site.id)}
              title="Clear cookies for this site"
            >Logout</button>
            <button
              onclick={() => removeSite(site.id)}
              title="Remove site and clear its cookies"
            >Remove</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Form vocabulary, scoped to this panel — same convention every dialog in
     the app follows (each carries its own .field / .hint rules). */
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text);
    font-size: 12px;
  }
  .field label { color: var(--text); }
  .field input[type="text"] {
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
  }
  .field input[type="text"]:focus {
    outline: none;
    border-color: var(--accent);
  }
  .hint {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }

  .site-add-row {
    display: flex;
    gap: 6px;
  }
  .site-add-row input {
    flex: 1;
    min-width: 0;
  }
  .sites-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .site-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .site-info {
    flex: 1;
    min-width: 0;
  }
  .site-label {
    font-size: 13px;
    color: var(--text);
  }
  .site-meta {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .site-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
</style>
