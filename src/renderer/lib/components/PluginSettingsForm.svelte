<script lang="ts">
  /**
   * One plugin's settings (#2636), rendered from the schema in its
   * `plugin.json`: text, number, on/off, a choice, and secrets. Values are
   * per machine. A secret is write-only — the field shows whether one is
   * saved, never what it is — and when this machine has no system key store
   * that's said plainly beside it (#2569).
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { getPluginsStore } from '../stores/plugins.svelte';
  import type { PluginSetting, PluginSettingsPatch, PluginSettingsView, PluginSettingValue } from '../../../shared/plugins/format';

  interface Props {
    id: string;
    name: string;
  }
  let { id, name }: Props = $props();

  const plugins = getPluginsStore();

  let view = $state<PluginSettingsView | null>(null);
  // The form's values: text for text and number inputs, booleans for checkboxes.
  let draft = $state<Record<string, string | boolean>>({});
  // A secret typed but not saved yet; '' leaves the saved one as it is.
  let secrets = $state<Record<string, string>>({});
  let error = $state<string | null>(null);
  let saved = $state(false);
  let saving = $state(false);

  function fill(v: PluginSettingsView): void {
    view = v;
    const d: Record<string, string | boolean> = {};
    for (const f of v.fields) {
      if (f.kind === 'secret') continue;
      const value = v.values[f.key];
      d[f.key] = f.kind === 'boolean' ? value === true : value === undefined ? '' : String(value);
    }
    draft = d;
    secrets = {};
  }

  onMount(() => {
    // A read, so the component may make it.
    api.plugins.settings(id).then(fill, (e: unknown) => { error = e instanceof Error ? e.message : String(e); });
  });

  /** What changed, as the patch main checks. */
  function patch(v: PluginSettingsView): PluginSettingsPatch {
    const out: PluginSettingsPatch = {};
    for (const f of v.fields) {
      if (f.kind === 'secret') {
        if (secrets[f.key]) out[f.key] = secrets[f.key]!;
        continue;
      }
      const now = draft[f.key];
      const was: PluginSettingValue | undefined = v.values[f.key];
      if (f.kind === 'boolean') {
        if (now !== (was === true)) out[f.key] = now === true;
      } else if (now !== (was === undefined ? '' : String(was))) {
        // An emptied field goes back to its default.
        out[f.key] = now === '' ? null : f.kind === 'number' ? Number(now) : (now as string);
      }
    }
    return out;
  }

  async function save(changes: PluginSettingsPatch): Promise<void> {
    if (Object.keys(changes).length === 0) return;
    error = null;
    saved = false;
    saving = true;
    try {
      fill(await plugins.saveSettings(id, changes));
      saved = true;
    } catch (e) {
      error = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
    } finally {
      saving = false;
    }
  }

  const label = (f: PluginSetting) => f.title;
  const hasSecrets = $derived(view?.fields.some((f) => f.kind === 'secret') ?? false);
</script>

{#if view}
  <form class="psettings" aria-label={`${name} settings`} onsubmit={(e) => { e.preventDefault(); if (view) void save(patch(view)); }}>
    {#each view.fields as f (f.key)}
      {@const inputId = `plugin-${id}-${f.key}`}
      <div class="pfield">
        {#if f.kind === 'boolean'}
          <label class="check" for={inputId}>
            <input id={inputId} type="checkbox" checked={draft[f.key] === true} onchange={(e) => { draft[f.key] = e.currentTarget.checked; saved = false; }} />
            {label(f)}
          </label>
        {:else}
          <label for={inputId}>{label(f)}</label>
          {#if f.kind === 'enum'}
            <select id={inputId} value={draft[f.key] as string} onchange={(e) => { draft[f.key] = e.currentTarget.value; saved = false; }}>
              {#if draft[f.key] === ''}<option value="" disabled>Choose…</option>{/if}
              {#each f.options as o (o)}<option value={o}>{o}</option>{/each}
            </select>
          {:else if f.kind === 'secret'}
            <div class="secret-row">
              <input
                id={inputId}
                type="password"
                autocomplete="off"
                placeholder={view.secretsSet[f.key] ? 'Saved — type to replace' : 'Not set'}
                value={secrets[f.key] ?? ''}
                oninput={(e) => { secrets[f.key] = e.currentTarget.value; saved = false; }}
              />
              {#if view.secretsSet[f.key]}
                <button type="button" class="link-btn" disabled={saving} onclick={() => { void save({ [f.key]: null }); }} aria-label={`Clear ${label(f)}`}>Clear</button>
              {/if}
            </div>
          {:else}
            <input
              id={inputId}
              type={f.kind === 'number' ? 'number' : 'text'}
              min={f.kind === 'number' ? f.minimum : undefined}
              max={f.kind === 'number' ? f.maximum : undefined}
              placeholder={f.default !== undefined ? String(f.default) : ''}
              value={draft[f.key] as string}
              oninput={(e) => { draft[f.key] = e.currentTarget.value; saved = false; }}
            />
          {/if}
        {/if}
        {#if f.description}<p class="pdesc">{f.description}</p>{/if}
      </div>
    {/each}
    {#if hasSecrets && view.secretsEncrypted === false}
      <p class="pdesc" data-testid="plugin-plaintext-note">
        This machine has no system secure store, so secrets are saved as plain text in a file only your user account can read.
      </p>
    {/if}
    <div class="pactions">
      <button type="submit" class="action-btn" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      {#if saved}<span class="pdesc" role="status">Saved.</span>{/if}
    </div>
    {#if error}<div class="perror" role="alert">{error}</div>{/if}
  </form>
{:else if error}
  <div class="perror" role="alert">{error}</div>
{/if}

<style>
  .psettings { margin: 6px 0 2px 24px; display: flex; flex-direction: column; gap: 8px; }
  .pfield { display: flex; flex-direction: column; gap: 3px; }
  .pfield > label { font-size: 11px; color: var(--text); }
  .check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text); }
  input[type='text'], input[type='number'], input[type='password'], select {
    max-width: 320px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
  }
  .secret-row { display: flex; align-items: center; gap: 8px; }
  .pdesc { margin: 0; color: var(--text-muted); font-size: 11px; line-height: 1.45; }
  .pactions { display: flex; align-items: center; gap: 8px; }
  .action-btn { padding: 3px 12px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-button); color: var(--text); font-size: 12px; cursor: pointer; }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .link-btn { padding: 0; border: none; background: none; color: var(--text-muted); font-size: 11px; text-decoration: underline; cursor: pointer; }
  .perror { padding: 6px 10px; border-left: 3px solid var(--accent); background: var(--bg); color: var(--text); font-size: 12px; white-space: pre-wrap; }
</style>
