<script lang="ts">
  /**
   * Appearance settings panel (#1600) — extracted from SettingsDialog. Theme,
   * content font, editor font size, and window zoom. All apply LIVE (not on
   * Done): theme/font via the $effects below, font-size/zoom via the host
   * callbacks. Self-contained bar the two App-level apply hooks it takes as props.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { getThemeMode, setThemeMode, THEME_MODES, type ThemeMode } from '../theme';
  import { getFontFamily, setFontFamily, FONT_FAMILY_PRESETS, type FontFamilyPreset } from '../appearance/settings';
  import { isFontInstalled } from '../appearance/font-detect';
  import { clampFontSize, parseStoredFontSize, MIN_FONT, MAX_FONT, DEFAULT_FONT } from '../editor/font-size';
  import { setZoom, getStoredZoom, MIN_ZOOM, MAX_ZOOM } from '../appearance/zoom';

  let { onApplyFontSize, onThemeChanged }: {
    onApplyFontSize: (px: number) => void;
    onThemeChanged: () => void;
  } = $props();

  let theme = $state<ThemeMode>(getThemeMode());
  let fontFamily = $state<FontFamilyPreset>(getFontFamily());
  // Font size seeds from the stored value; zoom reads the *live* frame factor in
  // onMount so the field reflects whatever the View-menu zoom shortcuts left.
  let editorFontSize = $state(clampFontSize(parseStoredFontSize(localStorage.getItem('editorFontSize'))));
  let zoomPercent = $state(Math.round(getStoredZoom() * 100));

  onMount(() => {
    zoomPercent = Math.round(api.view.getZoomFactor() * 100);
  });

  function applyEditorFontSize(px: number): void {
    if (!Number.isFinite(px)) return; // ignore an empty / mid-edit field
    editorFontSize = clampFontSize(px);
    onApplyFontSize(editorFontSize);
  }

  function applyZoomPercent(percent: number): void {
    if (!Number.isFinite(percent)) return;
    const applied = setZoom(percent / 100);
    zoomPercent = Math.round(applied * 100);
  }

  const fontPresets = Object.entries(FONT_FAMILY_PRESETS).map(([id, def]) => ({
    id: id as FontFamilyPreset,
    label: def.label,
  }));
  // Soft "font not installed" hint: only named-face presets carry a `probe`;
  // heuristic, so it never blocks the choice — just surfaces the silent fallback.
  const fontProbe = $derived(FONT_FAMILY_PRESETS[fontFamily].probe);
  const fontMissing = $derived(fontProbe !== undefined && !isFontInstalled(fontProbe));

  // Live-apply theme + font as the user picks them (no Done gate).
  $effect(() => {
    setThemeMode(theme);
    onThemeChanged();
  });
  $effect(() => {
    setFontFamily(fontFamily);
    // Same fan-out as a theme change: the canvas surfaces can't pick a CSS
    // custom-property change up on their own, and mermaid in particular *sizes*
    // its labels against this font — leave it stale and every diagram keeps
    // boxes measured for the previous font (#1802).
    onThemeChanged();
  });
</script>

<div class="appearance">
      <div class="field">
        <label for="theme">Theme</label>
        <select id="theme" bind:value={theme}>
          {#each THEME_MODES as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
        <p class="hint">
          You can also cycle themes from the status bar or with <kbd>⌘⇧T</kbd>.
        </p>
      </div>
      <div class="field">
        <label for="font-family">Content font</label>
        <select id="font-family" bind:value={fontFamily}>
          {#each fontPresets as p}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
        <p class="hint">
          Applies to the markdown editor and preview. App chrome always uses the system font.
        </p>
        {#if fontMissing && fontProbe}
          <p class="hint font-missing">
            “{fontProbe}” doesn’t appear to be installed — the editor will use a fallback font.
            Install {fontProbe}, or pick another option.
          </p>
        {/if}
      </div>
      <div class="field">
        <label for="editor-font-size">Editor font size</label>
        <div class="inline-num">
          <input
            id="editor-font-size"
            type="number"
            min={MIN_FONT}
            max={MAX_FONT}
            step="1"
            value={editorFontSize}
            onchange={(e) => applyEditorFontSize(parseInt(e.currentTarget.value, 10))}
          />
          <span class="unit">px</span>
          <button class="btn-inline" onclick={() => applyEditorFontSize(DEFAULT_FONT)}>Reset</button>
        </div>
        <p class="hint">
          Size of the text in the source editor only ({MIN_FONT}–{MAX_FONT}px). Also
          adjustable with <kbd>⌘⇧=</kbd> / <kbd>⌘⇧-</kbd>.
        </p>
      </div>
      <div class="field">
        <label for="window-zoom">Window zoom</label>
        <div class="inline-num">
          <input
            id="window-zoom"
            type="number"
            min={Math.round(MIN_ZOOM * 100)}
            max={Math.round(MAX_ZOOM * 100)}
            step="10"
            value={zoomPercent}
            onchange={(e) => applyZoomPercent(parseInt(e.currentTarget.value, 10))}
          />
          <span class="unit">%</span>
          <button class="btn-inline" onclick={() => applyZoomPercent(100)}>Reset</button>
        </div>
        <p class="hint">
          Scales the whole window — sidebar, toolbar, dialogs, and the editor together.
          Also adjustable with <kbd>⌘+</kbd> / <kbd>⌘-</kbd> / <kbd>⌘0</kbd>.
        </p>
      </div>

</div>

<style>
  .appearance { display: flex; flex-direction: column; gap: 14px; }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text);
    font-size: 12px;
  }
  .field label {
    color: var(--text);
  }
  .field select {
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
  }
  .field select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .inline-num {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .inline-num .unit {
    font-size: 12px;
    color: var(--text-muted);
  }
  .inline-num input[type="number"] {
    width: 80px;
    padding: 4px 6px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
  }
  .btn-inline {
    padding: 4px 10px;
    background: var(--bg-button, var(--bg));
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .btn-inline:hover {
    border-color: var(--accent);
  }
  .hint {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
  .hint.font-missing {
    color: var(--rust);
    margin-top: 4px;
  }
  kbd {
    background: var(--bg-button);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 4px;
    font-size: 10px;
    font-family: ui-monospace, monospace;
  }
</style>
