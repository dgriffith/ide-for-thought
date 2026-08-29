<script lang="ts">
  /**
   * Sources settings panel (#1600) — extracted from SettingsDialog. Ingest
   * options + the privileged-sites list. `importUpstreamTags` is a Done-batched
   * setting, so it's bound back to the host (which loads + saves it), matching
   * the AiSettings pattern; SitesSettings is self-contained.
   */
  import SitesSettings from './SitesSettings.svelte';

  let { importUpstreamTags = $bindable() }: { importUpstreamTags: boolean } = $props();
</script>

<div class="sources">
      <h3 class="settings-subsection">Ingest</h3>
      <div class="field checkbox">
        <label>
          <input type="checkbox" bind:checked={importUpstreamTags} />
          Import upstream subject tags on source ingest
        </label>
        <p class="hint">
          When on, identifier ingest (DOI / arXiv id / PMID) applies the
          subject taxonomy each API surfaces as namespaced tags on the
          source: <code>crossref/sociology</code>,
          <code>arxiv/cs-lg</code>, <code>mesh/genetics</code>. Use the
          source's right-click "Strip upstream tags" to remove them
          after the fact.
        </p>
      </div>

      <h3 class="settings-subsection">Privileged sites</h3>
      <SitesSettings />

</div>

<style>
  .sources { display: flex; flex-direction: column; gap: 14px; }
  /* Base .field shape shared via global.css (#1910). */
  .field.checkbox label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .field input[type="checkbox"] {
    cursor: pointer;
  }
  .hint {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
  .hint code {
    background: var(--bg-button);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
  }
  .settings-subsection {
    margin: 18px 0 8px 0;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .settings-subsection:first-child {
    margin-top: 0;
  }
</style>
