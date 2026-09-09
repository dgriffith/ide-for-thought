<script lang="ts">
  /**
   * Notes settings panel (#2107) — extracted from SettingsDialog's inline
   * "notes" tab body. Covers the Refactor extraction destination/templates
   * (per-change via the refactor-settings write-through helper, like
   * BehaviorsSettings/VersioningSettings) and the excerpt-note default
   * destination folder (async-loaded on mount, saved through the settings
   * store). Self-contained: no props, mirrors the sibling tab pattern.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { getSettingsStore } from '../stores/settings.svelte';
  import { makePatch } from '../make-patch';
  import { logger } from '../../../shared/logger';
  import {
    getRefactorSettings,
    setRefactorSettings,
    type DestinationMode,
    type RefactorSettings,
  } from '../refactor/settings';

  const settings = getSettingsStore();

  // A "patch" merges a delta into the local $state mirror AND persists it
  // per-change (unlike the Done-batched editor/appearance/web/ai). #1600.
  let refactor = $state<RefactorSettings>({ ...getRefactorSettings() });
  const patchRefactor = makePatch(() => refactor, (v) => { refactor = v; }, setRefactorSettings);

  const DESTINATION_OPTIONS: { value: DestinationMode; label: string }[] = [
    { value: 'same-folder', label: 'Same folder as source note' },
    { value: 'root', label: 'Thoughtbase root' },
    { value: 'custom', label: 'Custom folder (template)' },
  ];

  // Excerpt → Note default folder (#101). Empty string = project root.
  let excerptNoteFolder = $state('');

  onMount(async () => {
    try {
      excerptNoteFolder = await api.sources.getExcerptNoteFolder();
    } catch (e) {
      logger('settings').error('failed to load excerpt settings:', e);
    }
  });

  async function commitExcerptNoteFolder(next: string): Promise<void> {
    excerptNoteFolder = next;
    try {
      await settings.setExcerptNoteFolder(next);
    } catch (e) {
      logger('settings').error('failed to save excerpt folder:', e);
    }
  }
</script>

<div class="notes">
  <h3 class="settings-subsection">Refactoring</h3>
  <div class="field">
    <label for="destination">Destination for new notes</label>
    <select
      id="destination"
      value={refactor.destination}
      onchange={(e) => patchRefactor({ destination: e.currentTarget.value as DestinationMode })}
    >
      {#each DESTINATION_OPTIONS as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    <p class="hint">
      Applies to Extract Selection, Split Here, and Split by Heading.
    </p>
  </div>
  {#if refactor.destination === 'custom'}
    <div class="field">
      <label for="destination-template">Custom folder template</label>
      <input
        id="destination-template"
        type="text"
        value={refactor.destinationTemplate}
        oninput={(e) => patchRefactor({ destinationTemplate: e.currentTarget.value })}
        placeholder={'e.g. notes/{{date:YYYY}}/{{date:MM}}'}
      />
      <p class="hint">
        Tokens: <code>{'{{date:YYYY}}'}</code>, <code>{'{{date:MM}}'}</code>,
        <code>{'{{date:DD}}'}</code>, <code>{'{{title}}'}</code>,
        <code>{'{{source}}'}</code>. Leave blank to use the thoughtbase root.
      </p>
    </div>
  {/if}
  <div class="field">
    <label for="filename-prefix">Filename prefix</label>
    <input
      id="filename-prefix"
      type="text"
      value={refactor.filenamePrefix}
      oninput={(e) => patchRefactor({ filenamePrefix: e.currentTarget.value })}
      placeholder={'e.g. {{date:YYYYMMDDHHmm}}-'}
    />
    <p class="hint">
      Prepended to every refactored note's filename. Supports the same tokens.
      Zettelkasten users often set something like <code>{'{{date:YYYYMMDDHHmm}}-'}</code>.
    </p>
  </div>
  <div class="field checkbox">
    <label>
      <input
        type="checkbox"
        checked={refactor.normalizeHeadings}
        onchange={(e) => patchRefactor({ normalizeHeadings: e.currentTarget.checked })}
      />
      Normalize heading levels in extracted notes
    </label>
    <p class="hint">
      When the extracted body's shallowest heading is H2 or deeper, shift every
      heading up so it becomes H1. Only affects the new note's body; the source
      is never touched.
    </p>
  </div>
  <div class="field checkbox">
    <label>
      <input
        type="checkbox"
        checked={refactor.transcludeByDefault}
        onchange={(e) => patchRefactor({ transcludeByDefault: e.currentTarget.checked })}
        disabled={!!refactor.linkTemplate}
      />
      Transclude by default
    </label>
    <p class="hint">
      Refactor commands emit <code>![[new-note]]</code> in the source so the
      preview inlines the extracted content. Overridden when a link template
      is set below.
    </p>
  </div>
  <div class="field">
    <label for="link-template">Link template</label>
    <textarea
      id="link-template"
      rows="3"
      value={refactor.linkTemplate}
      oninput={(e) => patchRefactor({ linkTemplate: e.currentTarget.value })}
      placeholder={'e.g. > See [[{{new_note_title}}]] — split from {{title}} on {{date}}'}
    ></textarea>
    <p class="hint">
      What to put in the source note in place of the extracted content. When
      blank, Minerva uses a plain wiki-link (or <code>![[…]]</code> if
      transclude is enabled). Tokens: <code>{'{{new_note_title}}'}</code>,
      <code>{'{{title}}'}</code>, <code>{'{{source}}'}</code>,
      <code>{'{{date}}'}</code>.
    </p>
  </div>
  <div class="field">
    <label for="refactored-note-template">Refactored note template</label>
    <textarea
      id="refactored-note-template"
      rows="4"
      value={refactor.refactoredNoteTemplate}
      oninput={(e) => patchRefactor({ refactoredNoteTemplate: e.currentTarget.value })}
      placeholder={'e.g. > Extracted from [[{{source}}]] on {{date}}\n\n{{new_note_content}}'}
    ></textarea>
    <p class="hint">
      Wraps each extracted note's body. Leave blank to use the raw extracted
      content unchanged. Must reference <code>{'{{new_note_content}}'}</code>
      somewhere or the body will be dropped.
    </p>
  </div>

  <h3 class="settings-subsection">Excerpt notes</h3>
  <div class="field">
    <label for="excerpt-note-folder">Default destination folder</label>
    <input
      id="excerpt-note-folder"
      type="text"
      placeholder="(project root)"
      value={excerptNoteFolder}
      onchange={(e) => { void commitExcerptNoteFolder(e.currentTarget.value); }}
    />
    <p class="hint">
      Project-relative folder where "New note from excerpt" lands. Empty
      means the project root. The folder is created on first write.
      Stored per-project in <code>.minerva/config.json</code>.
    </p>
  </div>
</div>

<style>
  .notes {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
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
  .field input[type="text"],
  .field select,
  .field textarea {
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
  }
  .field input[type="text"]:focus,
  .field select:focus,
  .field textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .field textarea {
    resize: vertical;
    min-height: 60px;
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
