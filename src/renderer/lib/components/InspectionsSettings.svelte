<script lang="ts">
  /**
   * Inspections settings panel (#1792).
   *
   * Which health checks run, and the two day thresholds that decide what counts
   * as "stale" and "long-unresolved". Rendered from the shared catalog rather
   * than a hand-kept list here, so a check can't gain a switch that controls
   * nothing — or run with no way to switch it off.
   *
   * The argument-map checks (`hidden` in the catalog) are deliberately absent:
   * they belong to a feature that isn't user-facing yet. They keep running; the
   * panel just doesn't advertise them.
   *
   * Reads directly (allowed for components); writes go through the settings
   * store per the renderer data-flow rule.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { getSettingsStore } from '../stores/settings.svelte';
  import { logger } from '../../../shared/logger';
  import {
    visibleInspections,
    INSPECTION_GROUP_LABELS,
    DEFAULT_INSPECTION_SETTINGS,
    type InspectionGroup,
    type InspectionSettings,
  } from '../../../shared/inspections';

  const settingsStore = getSettingsStore();

  let settings = $state<InspectionSettings>({ ...DEFAULT_INSPECTION_SETTINGS });
  let loaded = $state(false);

  /** Catalog entries grouped for display, in catalog order. */
  const groups = $derived.by(() => {
    const out = new Map<InspectionGroup, ReturnType<typeof visibleInspections>>();
    for (const def of visibleInspections()) {
      const list = out.get(def.group) ?? [];
      list.push(def);
      out.set(def.group, list);
    }
    return [...out.entries()];
  });

  const enabledCount = $derived(
    visibleInspections().filter((d) => !settings.disabled.includes(d.type)).length,
  );

  onMount(async () => {
    try {
      settings = await api.graph.inspectionSettings();
    } catch (e) {
      logger('settings').error('failed to load inspection settings:', e);
    } finally {
      loaded = true;
    }
  });

  /** Persist, then adopt what was actually saved — days are clamped on the way
   *  in, so echoing the request back would show a value that isn't real. */
  async function save(next: InspectionSettings): Promise<void> {
    settings = next;
    settings = await settingsStore.setInspectionSettings(next);
  }

  function toggle(type: string, on: boolean): void {
    const disabled = on
      ? settings.disabled.filter((t) => t !== type)
      : [...settings.disabled, type];
    void save({ ...settings, disabled });
  }

  function setAll(on: boolean): void {
    void save({
      ...settings,
      disabled: on ? [] : visibleInspections().map((d) => d.type),
    });
  }

  function setDays(key: 'staleDays' | 'stubDays', raw: string): void {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    void save({ ...settings, [key]: n });
  }
</script>

{#if !loaded}
  <p class="hint">Loading…</p>
{:else}
  <p class="hint intro">
    Inspections are the standing checks Minerva runs over your thoughtbase — broken links,
    notes going stale, sources missing the details a citation needs. Findings appear in the
    Inspections panel in the right sidebar. Nothing here changes your notes; it only decides
    what gets pointed out.
  </p>

  <div class="bulk">
    <span class="count">{enabledCount} of {visibleInspections().length} checks on</span>
    <button type="button" onclick={() => setAll(true)} disabled={enabledCount === visibleInspections().length}>
      Enable all
    </button>
    <button type="button" onclick={() => setAll(false)} disabled={enabledCount === 0}>
      Disable all
    </button>
  </div>

  {#each groups as [group, defs] (group)}
    <h3 class="settings-subsection">{INSPECTION_GROUP_LABELS[group]}</h3>
    {#each defs as def (def.type)}
      {@const on = !settings.disabled.includes(def.type)}
      <div class="field checkbox">
        <label>
          <input type="checkbox" checked={on} onchange={(e) => toggle(def.type, e.currentTarget.checked)} />
          {def.label}
        </label>
        <p class="hint">{def.description}</p>

        {#if def.type === 'stale_note' && on}
          <div class="threshold">
            <label for="stale-days">Call a note stale after</label>
            <input
              id="stale-days" type="number" min="1" max="3650"
              value={settings.staleDays}
              onchange={(e) => setDays('staleDays', e.currentTarget.value)}
            />
            <span>days</span>
          </div>
        {/if}
        {#if def.type === 'stub_aged' && on}
          <div class="threshold">
            <label for="stub-days">Flag an unresolved stub after</label>
            <input
              id="stub-days" type="number" min="1" max="3650"
              value={settings.stubDays}
              onchange={(e) => setDays('stubDays', e.currentTarget.value)}
            />
            <span>days</span>
          </div>
        {/if}
      </div>
    {/each}
  {/each}
{/if}

<style>
  .intro { margin-bottom: 14px; }
  .bulk { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .count { font-size: 0.82rem; color: var(--text-muted); margin-right: auto; }
  .bulk button {
    background: var(--bg-button); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 3px 10px; font-size: 0.8rem; cursor: pointer;
  }
  .bulk button:hover:not(:disabled) { background: var(--bg-button-hover); }
  .bulk button:disabled { opacity: 0.5; cursor: default; }

  .threshold { display: flex; align-items: center; gap: 8px; margin: 6px 0 0 24px; font-size: 0.82rem; color: var(--text-muted); }
  .threshold input { width: 5em; }
</style>
