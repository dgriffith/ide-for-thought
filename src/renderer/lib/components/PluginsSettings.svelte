<script lang="ts">
  /**
   * Settings → Plugins (#2634): what's installed in ~/.minerva/plugins/, on
   * or off, what each contributes, and the ones refused with why. Every
   * change applies at once, in every window — no restart.
   *
   * The install buttons sit at the top. Below, the lists show each plugin's
   * toggle and name (and author) only; everything else about the selected
   * one (its description, what it adds and may do, where it came from, its
   * settings, Remove) is in the detail pane beside them.
   */
  import { onMount } from 'svelte';
  import { getPluginsStore } from '../stores/plugins.svelte';
  import { getDialogStore } from '../stores/dialogs.svelte';
  import { CONFIRM_KEYS } from '../confirm-keys';
  import PluginSettingsForm from './PluginSettingsForm.svelte';
  import type { PluginContributionPoint, PluginList, PluginRecommendation, PluginSummary } from '../../../shared/plugins/format';
  import { describeCapabilities } from '../../../shared/plugins/capabilities';
  import { codePluginsStore } from '../stores/code-plugins.svelte';
  import { formatAccelerator } from '../command-palette/format-accelerator';
  import { renderPluginDescription } from '../plugins/plugin-description';
  import { api } from '../ipc/client';

  /** A link in a description opens in the browser (http(s) only, main checks), never in the window. */
  function openDescriptionLink(e: MouseEvent): void {
    const a = (e.target as Element | null)?.closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href) void api.shell.openExternal(href);
  }

  /** A plugin command's shortcut another plugin already has (#2879), in words. */
  const keyConflicts = $derived(codePluginsStore.commandKeys().conflicts);
  function conflictsOf(id: string): string[] {
    return keyConflicts.filter((c) => c.pluginId === id)
      .map((c) => `"${c.title}" has no shortcut: ${formatAccelerator(c.key)} is ${c.takenBy}'s.`);
  }

  const plugins = getPluginsStore();
  // Built-in plugins split two ways: parts of Minerva, and the samples
  // shipped as worked examples of a plugin seam.
  const builtIn = $derived(plugins.list.core.filter((p) => !p.sample));
  const samples = $derived(plugins.list.core.filter((p) => p.sample));
  /** Whether plugins' MCP servers can run (#2891): they're programs, so only while Local MCP servers is on. */
  const localServersOn = $derived(plugins.list.core.some((c) => c.id === 'local-mcp-servers' && c.enabled));
  const dialogs = getDialogStore();

  onMount(() => { void plugins.refresh(); });

  // The plugin shown in the detail pane, as `<list>:<id>`: a recommendation can
  // share its id with an installed plugin.
  let selected = $state<string | null>(null);
  type Detail =
    | { kind: 'core' | 'installed'; plugin: PluginSummary }
    | { kind: 'error'; error: PluginList['errors'][number] }
    | { kind: 'rec'; rec: PluginRecommendation };
  const detail = $derived.by<Detail | null>(() => {
    if (!selected) return null;
    const at = selected.indexOf(':');
    const kind = selected.slice(0, at);
    const id = selected.slice(at + 1);
    if (kind === 'core' || kind === 'installed') {
      const plugin = plugins.list[kind].find((p) => p.id === id);
      return plugin ? { kind, plugin } : null;
    }
    if (kind === 'error') {
      const error = plugins.list.errors.find((e) => e.folder === id);
      return error ? { kind, error } : null;
    }
    const rec = plugins.recommendations.find((r) => r.id === id);
    return rec ? { kind: 'rec', rec } : null;
  });

  const detailName = $derived(
    !detail ? '' : detail.kind === 'error' ? detail.error.label : detail.kind === 'rec' ? (detail.rec.name ?? detail.rec.id) : detail.plugin.name,
  );

  // The plugin whose settings form is open (#2636): one at a time.
  let settingsOpen = $state<string | null>(null);

  const NOUNS: Record<PluginContributionPoint, [string, string]> = {
    'skills': ['skill', 'skills'],
    'object-types': ['type', 'types'],
    'saved-queries': ['query', 'queries'],
    'note-templates': ['template', 'templates'],
    'csl-styles': ['citation style', 'citation styles'],
    'themes': ['theme', 'themes'],
    'inspections': ['inspection', 'inspections'],
  };

  function contributes(p: PluginSummary): string {
    const parts = (Object.entries(p.contributes) as [PluginContributionPoint, number][])
      .map(([point, n]) => `${n} ${NOUNS[point][n === 1 ? 0 : 1]}`);
    // Its servers are listed, and turned on, in Settings → MCP Servers (#2646).
    if (p.mcpServers) parts.push(`${p.mcpServers} MCP ${p.mcpServers === 1 ? 'server' : 'servers'}`);
    if (p.capabilities) parts.push('code');
    return parts.join(' · ');
  }

  /** Where it came from, in a line. */
  function source(p: PluginSummary): string {
    const src = p.source;
    switch (src.kind) {
      case 'folder': return `From ${src.path}`;
      case 'zip': return `From ${src.name}`;
      case 'git': return `From ${src.url}${src.ref ? ` #${src.ref}` : ''} at ${src.commit.slice(0, 7)}`;
      case 'manual': return 'Put in the plugins folder by hand';
      case 'draft': return 'Drafted in a conversation';
      case 'core': return 'Built into Minerva';
    }
  }

  async function installGit(): Promise<void> {
    const spec = await dialogs.showPrompt('Git URL of a public repository (add #tag, #branch or #commit to pin a version):');
    if (spec?.trim()) await plugins.installGit(spec.trim());
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

{#snippet pick(key: string, name: string, by?: string)}
  <button
    type="button"
    class="plugin-pick"
    aria-pressed={selected === key}
    aria-controls="plugin-detail"
    onclick={() => { selected = key; }}
  ><span class="plugin-name">{name}</span>{#if by}<span class="plugin-by">{by}</span>{/if}</button>
{/snippet}

{#snippet toggle(p: PluginSummary)}
  <input
    type="checkbox"
    checked={p.enabled}
    disabled={plugins.busy}
    aria-label={`${p.enabled ? 'Turn off' : 'Turn on'} ${p.name}`}
    onchange={(e) => { void plugins.setEnabled(p.id, e.currentTarget.checked); }}
  />
{/snippet}

{#snippet coreList(list: PluginSummary[], label: string)}
  <ul class="plugin-list" aria-label={label}>
    {#each list as p (p.id)}
      <li class:off={!p.enabled} class:selected={selected === `core:${p.id}`}>
        {@render toggle(p)}
        {@render pick(`core:${p.id}`, p.name)}
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet description(text: string)}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="detail-desc" onclick={openDescriptionLink}>{@html renderPluginDescription(text)}</div>
{/snippet}

{#snippet notes(p: PluginSummary)}
  {#if p.capabilities?.length}<p class="detail-line">{describeCapabilities(p.capabilities)}</p>{/if}
  {#each conflictsOf(p.id) as line (line)}<p class="detail-line">{line}</p>{/each}
{/snippet}

<div class="field">
  <div class="actions">
    <button class="action-btn" disabled={plugins.busy} onclick={() => { void plugins.installFolder(); }}>Install from folder…</button>
    <button class="action-btn" disabled={plugins.busy} onclick={() => { void plugins.installZip(); }}>Install from zip…</button>
    <button class="action-btn" disabled={plugins.busy} onclick={() => { void installGit(); }}>Install from git URL…</button>
    <button class="action-btn" onclick={() => { void plugins.reveal(); }}>Show plugins folder</button>
  </div>

  {#if plugins.error}
    <div class="plugins-error" role="alert">{plugins.error}</div>
  {/if}

  <div class="plugins-body">
    <div class="plugins-lists">
      {#if builtIn.length > 0}
        <span class="field-label">Built in</span>
        <p class="hint">Parts of Minerva. Turned off, one isn't running at all.</p>
        {@render coreList(builtIn, 'Built-in plugins')}
      {/if}

      {#if samples.length > 0}
        <span class="field-label section-label">Samples</span>
        <p class="hint">Small worked examples of what a plugin can do. They start turned off.</p>
        {@render coreList(samples, 'Sample plugins')}
      {/if}

      <span class="field-label" class:section-label={plugins.list.core.length > 0}>Installed plugins</span>
      <p class="hint">In <code>~/.minerva/plugins/</code> on this machine.</p>

      {#if plugins.list.installed.length === 0 && plugins.list.errors.length === 0}
        <p class="hint empty">No plugins installed.</p>
      {:else}
        <ul class="plugin-list" aria-label="Installed plugins">
          {#each plugins.list.installed as p (p.id)}
            <li class:off={!p.enabled} class:selected={selected === `installed:${p.id}`}>
              {@render toggle(p)}
              {@render pick(`installed:${p.id}`, p.name, p.author)}
              {#if p.codeApproval}<span class="plugin-flag">Needs allowing</span>{/if}
            </li>
          {/each}
          {#each plugins.list.errors as e (e.folder)}
            <li class="refused off" class:selected={selected === `error:${e.folder}`}>
              <span class="toggle-gap"></span>
              {@render pick(`error:${e.folder}`, e.label)}
              <span class="plugin-flag">Not loaded</span>
            </li>
          {/each}
        </ul>
      {/if}

      {#if plugins.recommendations.length > 0}
        <span class="field-label section-label">Recommended by this thoughtbase</span>
        <ul class="plugin-list" aria-label="Recommended by this thoughtbase">
          {#each plugins.recommendations as r (r.id)}
            <li class="off" class:selected={selected === `rec:${r.id}`}>
              <span class="toggle-gap"></span>
              {@render pick(`rec:${r.id}`, r.name ?? r.id)}
              {#if r.status === 'disabled'}
                <button class="link-btn" disabled={plugins.busy} onclick={() => { void plugins.setEnabled(r.id, true); }} aria-label={`Turn on ${r.name ?? r.id}`}>Turn on</button>
              {:else if r.installUrl}
                <button class="link-btn" disabled={plugins.busy} onclick={() => { void plugins.installGit(r.installUrl!); }} aria-label={`Install ${r.name ?? r.id}`}>Install</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <section id="plugin-detail" class="plugin-detail" aria-label={detail ? `About ${detailName}` : 'About the selected plugin'}>
      {#if !detail}
        <p class="hint empty">Select a plugin to see what it does.</p>
      {:else if detail.kind === 'core'}
        {@const p = detail.plugin}
        <h3 class="detail-name">{p.name}</h3>
        {@render description(p.description)}
        {@render notes(p)}
      {:else if detail.kind === 'installed'}
        {@const p = detail.plugin}
        <h3 class="detail-name">{p.name} <span class="detail-version">{p.version}</span></h3>
        {#if p.author}<p class="detail-line">By {p.author}</p>{/if}
        {@render description(p.description)}
        {#if contributes(p)}<p class="detail-line">Adds {contributes(p)}</p>{/if}
        {@render notes(p)}
        {#if p.codeApproval}
          <!-- Its code waits for the user (#2833): main asks, natively, with what changed. -->
          <p class="approval">
            {p.codeApproval === 'changed' ? 'Changed since you allowed it, so it\'s off until you allow it again.' : 'It runs code, so it\'s off until you allow it.'}
            <button class="link-btn" disabled={plugins.busy} onclick={() => { void plugins.approveCode(p.id); }} aria-label={`Review and allow ${p.name}`}>Review and allow…</button>
          </p>
        {/if}
        {#if p.mcpServers && !localServersOn}
          <!-- Its servers are programs (#2891): they wait on the built-in plugin. -->
          <p class="detail-line">Its MCP {p.mcpServers === 1 ? 'server needs' : 'servers need'} Local MCP servers, which is off, so {p.mcpServers === 1 ? 'it doesn\'t' : 'they don\'t'} start.</p>
        {/if}
        <p class="detail-line">{source(p)}</p>
        <div class="detail-actions">
          {#if p.settings}
            <button class="link-btn" aria-expanded={settingsOpen === p.id} onclick={() => { settingsOpen = settingsOpen === p.id ? null : p.id; }}>Settings</button>
          {/if}
          <button class="link-btn" onclick={() => { void plugins.reveal(p.id); }}>Show folder</button>
          <button class="link-btn" disabled={plugins.busy} onclick={() => { void remove(p); }} aria-label={`Remove ${p.name}`}>Remove</button>
        </div>
        {#if settingsOpen === p.id}<PluginSettingsForm id={p.id} name={p.name} />{/if}
      {:else if detail.kind === 'error'}
        <h3 class="detail-name">{detail.error.label}</h3>
        <p class="detail-line">Not loaded:</p>
        <ul class="problems">
          {#each detail.error.problems as problem, i (i)}<li>{problem}</li>{/each}
        </ul>
      {:else if detail.kind === 'rec'}
        {@const r = detail.rec}
        <h3 class="detail-name">{r.name ?? r.id}</h3>
        <p class="detail-line">{r.status === 'disabled' ? 'Installed, turned off' : 'Not installed'}</p>
        {#if r.reason}{@render description(r.reason)}{/if}
        {#if r.source && r.status === 'missing'}<p class="detail-line">{r.installUrl ? 'From' : 'Get it from'} {r.source}</p>{/if}
      {/if}
    </section>
  </div>
</div>

<style>
  .hint { margin: 2px 0 0 0; color: var(--text-muted); font-size: 11px; line-height: 1.45; }
  .hint code { background: var(--bg-button); padding: 1px 4px; border-radius: 3px; font-size: 10px; }
  .hint.empty { font-style: italic; margin: 0 0 8px 0; }
  .plugins-body { display: flex; gap: 12px; align-items: flex-start; margin-top: 12px; }
  .plugins-lists { flex: 0 1 260px; min-width: 200px; }
  .plugin-detail {
    flex: 1 1 0; min-width: 0; position: sticky; top: 0;
    padding: 8px 10px; border: 1px solid var(--border); border-radius: 3px; font-size: 12px;
    /* The content well: white in the light themes, the darkest surface in the dark one. */
    background: var(--bg-inset);
  }
  .plugin-list { list-style: none; margin: 4px 0 8px 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .plugin-list > li { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border: 1px solid transparent; border-radius: 3px; font-size: 12px; }
  .plugin-list > li:hover { background: var(--bg-button); }
  .plugin-list > li.selected { background: var(--bg-button); border-color: var(--border); }
  .plugin-list > li.off .plugin-name { color: var(--text-muted); }
  .plugin-list input { margin: 0; flex: none; }
  .toggle-gap { width: 13px; flex: none; }
  .plugin-pick {
    flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px;
    padding: 0; border: none; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
  }
  .plugin-name { color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .plugin-by, .plugin-flag { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
  .plugin-by { overflow: hidden; text-overflow: ellipsis; }
  .detail-name { margin: 0 0 4px 0; font-size: 13px; color: var(--text); }
  .detail-version { font-weight: 400; font-size: 11px; color: var(--text-muted); }
  .detail-desc { margin: 0 0 6px 0; color: var(--text); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
  .detail-desc :global(:is(p, ul, ol, pre, blockquote)) { margin: 0 0 6px 0; }
  .detail-desc :global(:is(ul, ol)) { padding-left: 18px; }
  .detail-desc :global(:is(h1, h2, h3, h4, h5, h6)) { margin: 8px 0 4px 0; font-size: 12px; }
  .detail-desc :global(code) { background: var(--bg-button); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
  .detail-desc :global(pre) { background: var(--bg-button); padding: 6px 8px; border-radius: 3px; overflow-x: auto; }
  .detail-desc :global(pre code) { padding: 0; background: none; }
  .detail-desc :global(blockquote) { padding-left: 8px; border-left: 2px solid var(--border); color: var(--text-muted); }
  .detail-desc :global(a) { color: var(--accent); }
  .detail-desc > :global(:last-child) { margin-bottom: 0; }
  .detail-line { margin: 2px 0 0 0; color: var(--text-muted); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
  .detail-actions { display: flex; gap: 10px; margin-top: 8px; }
  .approval { margin: 6px 0 0 0; color: var(--text); font-size: 11px; }
  .problems { margin: 4px 0 2px 0; padding-left: 18px; color: var(--text); font-size: 11px; line-height: 1.45; }
  .section-label { display: block; margin-top: 8px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .action-btn { padding: 4px 12px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-button); color: var(--text); font-size: 12px; cursor: pointer; }
  .action-btn:hover:not(:disabled) { background: var(--bg-button-hover); }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .link-btn { padding: 0; border: none; background: none; color: var(--text-muted); font-size: 11px; text-decoration: underline; cursor: pointer; }
  .link-btn:hover { color: var(--text); }
  .plugins-error { margin-top: 8px; padding: 6px 10px; border-left: 3px solid var(--accent); background: var(--bg-button); color: var(--text); font-size: 12px; white-space: pre-wrap; }
</style>
