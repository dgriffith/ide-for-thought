<script lang="ts">
  /**
   * Bibliography settings panel (CSL citation style + imported styles/locales,
   * #302, extracted from SettingsDialog for #672).
   *
   * Self-contained: owns the active style + the user-imported CSL asset lists,
   * loads on mount, and drives api.bibliography.* / api.csl.*. The active style
   * is per-project; imported assets live under .minerva/.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { getSettingsStore } from '../stores/settings.svelte';
  import { logger } from '../../../shared/logger';

  const settings = getSettingsStore();

  let bibliographyStyles = $state<{ id: string; label: string; isUser?: boolean }[]>([]);
  let bibliographyStyleId = $state('apa');
  let userStyles = $state<{ id: string; label: string; filePath: string }[]>([]);
  let userLocales = $state<{ id: string; filePath: string }[]>([]);
  let cslImportError = $state<string | null>(null);
  let cslImporting = $state(false);

  async function loadBibliographySettings(): Promise<void> {
    try {
      const [styles, current, uStyles, uLocales] = await Promise.all([
        api.bibliography.listStyles(),
        api.bibliography.getStyle(),
        api.csl.listUserStyles(),
        api.csl.listUserLocales(),
      ]);
      bibliographyStyles = styles;
      bibliographyStyleId = current;
      userStyles = uStyles;
      userLocales = uLocales;
    } catch (e) {
      logger('settings').error('failed to load bibliography settings:', e);
    }
  }

  async function setBibliographyStyle(next: string): Promise<void> {
    bibliographyStyleId = next;
    try {
      await settings.setBibliographyStyle(next);
    } catch (e) {
      logger('settings').error('failed to save bibliography style:', e);
    }
  }

  async function importUserStyle(): Promise<void> {
    cslImportError = null;
    cslImporting = true;
    try {
      const result = await settings.importCslStyle();
      if (result) await loadBibliographySettings();
    } catch (e) {
      cslImportError = e instanceof Error ? e.message : String(e);
    } finally {
      cslImporting = false;
    }
  }

  async function importUserLocale(): Promise<void> {
    cslImportError = null;
    cslImporting = true;
    try {
      const result = await settings.importCslLocale();
      if (result) await loadBibliographySettings();
    } catch (e) {
      cslImportError = e instanceof Error ? e.message : String(e);
    } finally {
      cslImporting = false;
    }
  }

  async function removeUserStyle(id: string): Promise<void> {
    cslImportError = null;
    try {
      await settings.removeCslStyle(id);
      await loadBibliographySettings();
    } catch (e) {
      cslImportError = e instanceof Error ? e.message : String(e);
    }
  }

  async function removeUserLocale(id: string): Promise<void> {
    cslImportError = null;
    try {
      await settings.removeCslLocale(id);
      await loadBibliographySettings();
    } catch (e) {
      cslImportError = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(loadBibliographySettings);
</script>

<div class="field">
  <label for="csl-style">Citation style</label>
  <select
    id="csl-style"
    value={bibliographyStyleId}
    onchange={(e) => { void setBibliographyStyle(e.currentTarget.value); }}
  >
    {#each bibliographyStyles as style (style.id)}
      <option value={style.id}>
        {style.label}{style.isUser ? ' (imported)' : ''}
      </option>
    {/each}
  </select>
  <p class="hint">
    Used by Refactor → Insert/Update Bibliography. Stored per-project
    in <code>.minerva/config.json</code>, so different thoughtbases can
    follow different style guides.
  </p>
</div>

<div class="field">
  <span class="field-label">Imported styles</span>
  <p class="hint">
    Drop additional <code>.csl</code> files into your project under
    <code>.minerva/csl-styles/</code> — they show up in the picker above and
    in the Export dialog. The Zotero Style Repository at
    <a
      class="ext-link"
      href="https://www.zotero.org/styles"
      onclick={(e) => { e.preventDefault(); void api.shell.openExternal('https://www.zotero.org/styles'); }}
    >zotero.org/styles</a> publishes 10,000+ open styles.
  </p>
  {#if userStyles.length === 0}
    <p class="hint empty">No imported styles yet.</p>
  {:else}
    <ul class="csl-list">
      {#each userStyles as s (s.id)}
        <li>
          <span class="csl-label">{s.label}</span>
          <span class="csl-id">{s.id}</span>
          <button class="link-btn" onclick={() => { void removeUserStyle(s.id); }}>
            Remove
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <button
    class="action-btn"
    onclick={() => { void importUserStyle(); }}
    disabled={cslImporting}
  >
    Import .csl style…
  </button>
</div>

<div class="field">
  <span class="field-label">Imported locales</span>
  <p class="hint">
    Optional. Bundled locale is en-US; import additional CSL
    locale XML to render bibliographies in another language. The official
    locales live at
    <a
      class="ext-link"
      href="https://github.com/citation-style-language/locales"
      onclick={(e) => { e.preventDefault(); void api.shell.openExternal('https://github.com/citation-style-language/locales'); }}
    >github.com/citation-style-language/locales</a>.
  </p>
  {#if userLocales.length === 0}
    <p class="hint empty">No imported locales yet.</p>
  {:else}
    <ul class="csl-list">
      {#each userLocales as l (l.id)}
        <li>
          <span class="csl-label">{l.id}</span>
          <button class="link-btn" onclick={() => { void removeUserLocale(l.id); }}>
            Remove
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <button
    class="action-btn"
    onclick={() => { void importUserLocale(); }}
    disabled={cslImporting}
  >
    Import locale .xml…
  </button>
</div>

{#if cslImportError}
  <div class="csl-error">{cslImportError}</div>
{/if}

<style>
  /* Shared form vocabulary, scoped to this panel (app's per-dialog
     convention). The base .field shape moved to global.css (#1910). */
  .field label { color: var(--text); }
  .field select {
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
  }
  .field select:focus { outline: none; border-color: var(--accent); }
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
  .hint.empty {
    font-style: italic;
    margin: 0 0 8px 0;
  }
  .action-btn {
    align-self: flex-start;
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .action-btn:hover:not(:disabled) { background: var(--bg-button-hover); }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .link-btn {
    align-self: flex-start;
    margin-top: 4px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: underline;
    cursor: pointer;
  }
  .link-btn:hover { color: var(--text); }
  .ext-link {
    color: var(--accent);
    text-decoration: none;
    cursor: pointer;
  }
  .ext-link:hover { text-decoration: underline; }
  .csl-error {
    margin-top: 8px;
    padding: 6px 10px;
    border-left: 3px solid var(--accent);
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    font-family: var(--font-mono, ui-monospace, monospace);
    white-space: pre-wrap;
  }

  /* User-imported CSL assets list (#302). */
  .csl-list {
    list-style: none;
    margin: 0 0 8px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .csl-list li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    font-size: 12px;
  }
  .csl-list .csl-label {
    flex: 1;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .csl-list .csl-id {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
    color: var(--text-muted);
  }
  .csl-list .link-btn {
    align-self: auto;
    margin-top: 0;
  }
</style>
