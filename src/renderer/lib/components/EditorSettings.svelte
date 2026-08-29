<script lang="ts">
  /**
   * Editor settings panel (#1600) — extracted from SettingsDialog. Tab size +
   * editor toggles. Done-batched: the parent owns the `editor` state (bound here)
   * and persists it in handleDone via onApplyEditor.
   */
  import type { EditorSettings } from '../editor/settings';

  let { editor = $bindable() }: { editor: EditorSettings } = $props();
</script>

<div class="editor-settings">
      <div class="field">
        <label for="tab-size">Tab size</label>
        <input
          id="tab-size"
          type="number"
          min="1"
          max="8"
          bind:value={editor.tabSize}
        />
      </div>
      <div class="field checkbox">
        <label>
          <input type="checkbox" bind:checked={editor.wordWrap} />
          Word wrap
        </label>
      </div>
      <div class="field checkbox">
        <label>
          <input type="checkbox" bind:checked={editor.lineNumbers} />
          Show line numbers
        </label>
      </div>
      <div class="field checkbox">
        <label>
          <input type="checkbox" bind:checked={editor.showWhitespace} />
          Show whitespace
        </label>
      </div>
      <div class="field checkbox">
        <label>
          <input type="checkbox" bind:checked={editor.alwaysCollapseFrontmatter} />
          Always collapse frontmatter
        </label>
        <p class="hint">
          Automatically folds the YAML frontmatter block at the top of a note when it's opened.
        </p>
      </div>
      <div class="field checkbox">
        <label>
          <input type="checkbox" bind:checked={editor.numberedHeadings} />
          Numbered section headings
        </label>
        <p class="hint">
          Prefixes each H2 in the preview with a "§ 01" section numeral. Best for long-form
          essays; leave off for journals and lists.
        </p>
      </div>

</div>

<style>
  .editor-settings { display: flex; flex-direction: column; gap: 14px; }
  /* Base .field shape shared via global.css (#1910). */
  .field label {
    color: var(--text);
  }
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
  .field input[type="number"] {
    width: 80px;
    padding: 4px 6px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
  }
</style>
