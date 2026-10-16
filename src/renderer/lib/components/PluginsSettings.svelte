<script lang="ts">
  /**
   * Settings → Plugins (#2634): what's installed in ~/.minerva/plugins/, on
   * or off, what each contributes, and the ones refused with why. Every
   * change applies at once, in every window — no restart.
   */
  import { onMount } from 'svelte';
  import { getPluginsStore } from '../stores/plugins.svelte';
  import { getDialogStore } from '../stores/dialogs.svelte';
  import { CONFIRM_KEYS } from '../confirm-keys';
  import type { PluginContributionPoint, PluginSummary } from '../../../shared/plugins/format';

  const plugins = getPluginsStore();
  const dialogs = getDialogStore();

  onMount(() => { void plugins.refresh(); });

  const NOUNS: Record<PluginContributionPoint, [string, string]> = {
    'skills': ['skill', 'skills'],
    'object-types': ['type', 'types'],
    'saved-queries': ['query', 'queries'],
    'note-templates': ['template', 'templates'],
    'csl-styles': ['citation style', 'citation styles'],
  };

  function contributes(p: PluginSummary): string {
    return (Object.entries(p.contributes) as [PluginContributionPoint, number][])
      .map(([point, n]) => `${n} ${NOUNS[point][n === 1 ? 0 : 1]}`)
      .join(' · ');
  }

  async function remove(p: PluginSummary): Promise<void> {
    const ok = await dialogs.showConfirm(
      `Remove ${p.name}? Its folder in the plugins folder is deleted${p.source.kind === 'folder' ? ' (the folder you installed it from is kept)' : ''}.`,
      CONFIRM_KEYS.pluginRemove,
      'Remove',
    );
    if (ok) await plugins.remove(p.id);
  }
</script>

<div class="field">
  <span class="field-label">Installed plugins</span>
  <p class="hint">
    A plugin adds skills, object types, saved queries, note templates or citation styles,
    and lives in <code>~/.minerva/plugins/</code> on this machine. Turning one off or
    removing it takes effect at once.
  </p>

  {#if plugins.list.installed.length === 0 && plugins.list.errors.length === 0}
    <p class="hint empty">No plugins installed.</p>
  {:else}
    <ul class="plugin-list" aria-label="Installed plugins">
      {#each plugins.list.installed as p (p.id)}
        <li class:off={!p.enabled}>
          <div class="plugin-row">
            <input
              type="checkbox"
              checked={p.enabled}
              disabled={plugins.busy}
              aria-label={`${p.enabled ? 'Turn off' : 'Turn on'} ${p.name}`}
              onchange={(e) => { void plugins.setEnabled(p.id, e.currentTarget.checked); }}
            />
            <span class="plugin-name">{p.name}</span>
            <span class="plugin-version">{p.version}</span>
            <span class="plugin-contributes">{contributes(p)}</span>
            <span class="plugin-actions">
              <button class="link-btn" onclick={() => { void plugins.reveal(p.id); }}>Show folder</button>
              <button class="link-btn" disabled={plugins.busy} onclick={() => { void remove(p); }} aria-label={`Remove ${p.name}`}>Remove</button>
            </span>
          </div>
          <p class="plugin-desc">{p.description}{p.author ? ` — ${p.author}` : ''}</p>
        </li>
      {/each}
      {#each plugins.list.errors as e (e.folder)}
        <li class="refused">
          <div class="plugin-row">
            <span class="plugin-name">{e.label}</span>
            <span class="plugin-contributes">Not loaded</span>
          </div>
          <ul class="problems">
            {#each e.problems as problem, i (i)}<li>{problem}</li>{/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="actions">
    <button class="action-btn" disabled={plugins.busy} onclick={() => { void plugins.installFolder(); }}>Install from folder…</button>
    <button class="action-btn" disabled={plugins.busy} onclick={() => { void plugins.installZip(); }}>Install from zip…</button>
    <button class="action-btn" onclick={() => { void plugins.reveal(); }}>Show plugins folder</button>
  </div>

  {#if plugins.error}
    <div class="plugins-error" role="alert">{plugins.error}</div>
  {/if}
</div>

<style>
  .hint { margin: 2px 0 0 0; color: var(--text-muted); font-size: 11px; line-height: 1.45; }
  .hint code { background: var(--bg-button); padding: 1px 4px; border-radius: 3px; font-size: 10px; }
  .hint.empty { font-style: italic; margin: 0 0 8px 0; }
  .plugin-list { list-style: none; margin: 4px 0 8px 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .plugin-list > li { padding: 6px 8px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-button); font-size: 12px; }
  .plugin-list > li.off .plugin-name { color: var(--text-muted); }
  .plugin-row { display: flex; align-items: baseline; gap: 8px; }
  .plugin-name { color: var(--text); font-weight: 600; }
  .plugin-version, .plugin-contributes { font-size: 11px; color: var(--text-muted); }
  .plugin-contributes { flex: 1; }
  .plugin-actions { display: flex; gap: 10px; }
  .plugin-desc { margin: 2px 0 0 24px; color: var(--text-muted); font-size: 11px; line-height: 1.45; }
  .problems { margin: 4px 0 2px 0; padding-left: 18px; color: var(--text); font-size: 11px; line-height: 1.45; }
  .actions { display: flex; gap: 8px; }
  .action-btn { padding: 4px 12px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-button); color: var(--text); font-size: 12px; cursor: pointer; }
  .action-btn:hover:not(:disabled) { background: var(--bg-button-hover); }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .link-btn { padding: 0; border: none; background: none; color: var(--text-muted); font-size: 11px; text-decoration: underline; cursor: pointer; }
  .link-btn:hover { color: var(--text); }
  .plugins-error { margin-top: 8px; padding: 6px 10px; border-left: 3px solid var(--accent); background: var(--bg-button); color: var(--text); font-size: 12px; white-space: pre-wrap; }
</style>
