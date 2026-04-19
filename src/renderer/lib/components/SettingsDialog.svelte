<script lang="ts">
  import { onMount } from 'svelte';
  import { getEditorSettings, type EditorSettings } from '../editor/settings';
  import {
    getFontFamily,
    setFontFamily,
    FONT_FAMILY_PRESETS,
    type FontFamilyPreset,
  } from '../appearance/settings';
  import { getThemeMode, setThemeMode, type ThemeMode } from '../theme';
  import { api } from '../ipc/client';
  import type { LLMSettings, WebSettings } from '../../../shared/tools/types';
  import { getConfirmSuppressionStore } from '../stores/confirm-suppression.svelte';
  import { CONFIRM_REGISTRY, confirmRegistryEntry } from '../confirm-keys';
  import {
    getRefactorSettings,
    setRefactorSettings,
    type DestinationMode,
    type RefactorSettings,
  } from '../refactor/settings';

  interface Props {
    onApplyEditor: (s: EditorSettings) => void;
    onThemeChanged: () => void;
    onClose: () => void;
  }

  let { onApplyEditor, onThemeChanged, onClose }: Props = $props();

  type TabId = 'editor' | 'appearance' | 'behaviors' | 'refactoring' | 'web' | 'ai';
  const TABS: { id: TabId; label: string }[] = [
    { id: 'editor', label: 'Editor' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'behaviors', label: 'Behaviors' },
    { id: 'refactoring', label: 'Refactoring' },
    { id: 'web', label: 'Web' },
    { id: 'ai', label: 'AI' },
  ];

  let refactor = $state<RefactorSettings>({ ...getRefactorSettings() });
  function patchRefactor(patch: Partial<RefactorSettings>): void {
    refactor = { ...refactor, ...patch };
    setRefactorSettings(patch);
  }
  const DESTINATION_OPTIONS: { value: DestinationMode; label: string }[] = [
    { value: 'same-folder', label: 'Same folder as source note' },
    { value: 'root', label: 'Thoughtbase root' },
    { value: 'custom', label: 'Custom folder (template)' },
  ];

  const confirmSuppression = getConfirmSuppressionStore();
  // Derived view: every registered confirm, paired with its current suppressed flag.
  // Binds to the store's $state so toggling re-enables updates the row live.
  let confirmRows = $derived(
    CONFIRM_REGISTRY.map((entry) => ({
      entry,
      suppressed: confirmSuppression.suppressed.has(entry.key),
    }))
  );
  // Surface any unknown keys that got into localStorage from older builds so
  // users can still re-enable them — without pretending they belong here.
  let orphanSuppressedKeys = $derived(
    [...confirmSuppression.suppressed].filter((k) => !confirmRegistryEntry(k))
  );
  let suppressedCount = $derived(confirmRows.filter((r) => r.suppressed).length);
  let activeTab = $state<TabId>('editor');

  // Editor settings
  let editor = $state<EditorSettings>(getEditorSettings());

  // Appearance settings
  let theme = $state<ThemeMode>(getThemeMode());
  let fontFamily = $state<FontFamilyPreset>(getFontFamily());

  // Font presets as an array for the select
  const fontPresets = Object.entries(FONT_FAMILY_PRESETS).map(([id, def]) => ({
    id: id as FontFamilyPreset,
    label: def.label,
  }));

  const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'contrast', label: 'High Contrast' },
    { value: 'system', label: 'System' },
  ];

  // Web + AI settings (async-loaded from main process)
  let webEnabled = $state(true);
  let allowedDomainsText = $state('');
  let blockedDomainsText = $state('');
  let model = $state('claude-sonnet-4-6');
  let apiKeyInput = $state('');
  let apiKeyStatus = $state<'unknown' | 'set' | 'unset'>('unknown');
  let clearApiKey = $state(false);

  const MODEL_OPTIONS = [
    { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ];

  // Keep the dialog's own copy of saved LLM settings for Done-time diffing.
  let loadedLlm: LLMSettings | null = null;

  onMount(async () => {
    try {
      const s = (await api.tools.getSettings()) as LLMSettings;
      loadedLlm = s;
      model = s.model;
      apiKeyStatus = s.apiKey ? 'set' : 'unset';
      const web = s.web ?? { enabled: true, allowedDomains: [], blockedDomains: [] } as WebSettings;
      webEnabled = web.enabled;
      allowedDomainsText = web.allowedDomains.join('\n');
      blockedDomainsText = web.blockedDomains.join('\n');
    } catch (e) {
      console.error('[settings] failed to load LLM settings:', e);
    }
  });

  function parseDomains(text: string): string[] {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  async function handleDone() {
    // Editor — localStorage via Editor component
    onApplyEditor(editor);

    // Appearance — already applied live (theme + font) but persist just in case.
    setThemeMode(theme);
    setFontFamily(fontFamily);
    onThemeChanged();

    // Web + AI — build new LLMSettings and save
    const newApiKey = clearApiKey
      ? ''
      : apiKeyInput
        ? apiKeyInput
        : loadedLlm?.apiKey ?? '';
    const next: LLMSettings = {
      apiKey: newApiKey,
      model,
      web: {
        enabled: webEnabled,
        allowedDomains: parseDomains(allowedDomainsText),
        blockedDomains: parseDomains(blockedDomainsText),
      },
    };
    try {
      await api.tools.setSettings(next);
    } catch (e) {
      console.error('[settings] failed to save LLM settings:', e);
    }

    onClose();
  }

  // Live-apply theme and font changes as the user picks them, so they can
  // preview without committing — mirrors how the status-bar cycle already
  // applies immediately.
  $effect(() => {
    setThemeMode(theme);
    onThemeChanged();
  });
  $effect(() => {
    setFontFamily(fontFamily);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="overlay"
  onkeydown={handleKeydown}
  onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
  <div class="dialog" role="dialog" aria-label="Settings">
    <header>
      <h2>Settings</h2>
    </header>
    <div class="body">
      <nav class="tabs" aria-label="Settings sections">
        {#each TABS as tab}
          <button
            class="tab"
            class:active={activeTab === tab.id}
            onclick={() => { activeTab = tab.id; }}
          >{tab.label}</button>
        {/each}
      </nav>
      <section class="panel">
        {#if activeTab === 'editor'}
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

        {:else if activeTab === 'appearance'}
          <div class="field">
            <label for="theme">Theme</label>
            <select id="theme" bind:value={theme}>
              {#each THEME_OPTIONS as opt}
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
          </div>

        {:else if activeTab === 'behaviors'}
          <div class="field">
            <label>Don't-ask-again confirmations</label>
            <p class="hint">
              Dialogs you've muted via "Don't ask again." Re-enable a row to see its
              prompt next time the action occurs.
            </p>
          </div>
          <ul class="confirm-rows">
            {#each confirmRows as row}
              <li class="confirm-row" class:muted={!row.suppressed}>
                <div class="confirm-text">
                  <div class="confirm-title">{row.entry.title}</div>
                  <div class="confirm-desc">{row.entry.description}</div>
                </div>
                {#if row.suppressed}
                  <button
                    class="btn small"
                    onclick={() => confirmSuppression.unsuppress(row.entry.key)}
                  >Re-enable</button>
                {:else}
                  <span class="confirm-status">Active</span>
                {/if}
              </li>
            {/each}
            {#each orphanSuppressedKeys as key}
              <li class="confirm-row">
                <div class="confirm-text">
                  <div class="confirm-title">Unknown confirmation</div>
                  <div class="confirm-desc mono">{key}</div>
                </div>
                <button
                  class="btn small"
                  onclick={() => confirmSuppression.unsuppress(key)}
                >Re-enable</button>
              </li>
            {/each}
          </ul>
          <div class="field">
            <button
              class="btn secondary"
              disabled={suppressedCount === 0 && orphanSuppressedKeys.length === 0}
              onclick={() => confirmSuppression.clearAll()}
            >Show all confirmations again</button>
            <p class="hint">
              Clears every muted dialog at once.
            </p>
          </div>

        {:else if activeTab === 'refactoring'}
          <div class="field">
            <label for="destination">Destination for new notes</label>
            <select
              id="destination"
              value={refactor.destination}
              onchange={(e) => patchRefactor({ destination: (e.currentTarget as HTMLSelectElement).value as DestinationMode })}
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
                oninput={(e) => patchRefactor({ destinationTemplate: (e.currentTarget as HTMLInputElement).value })}
                placeholder="e.g. notes/{{date:YYYY}}/{{date:MM}}"
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
              oninput={(e) => patchRefactor({ filenamePrefix: (e.currentTarget as HTMLInputElement).value })}
              placeholder="e.g. {{date:YYYYMMDDHHmm}}-"
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
                onchange={(e) => patchRefactor({ normalizeHeadings: (e.currentTarget as HTMLInputElement).checked })}
              />
              Normalize heading levels in extracted notes
            </label>
            <p class="hint">
              When the extracted body's shallowest heading is H2 or deeper, shift every
              heading up so it becomes H1. Only affects the new note's body; the source
              is never touched.
            </p>
          </div>

        {:else if activeTab === 'web'}
          <div class="field checkbox">
            <label>
              <input type="checkbox" bind:checked={webEnabled} />
              Enable web access for conversations
            </label>
            <p class="hint">
              When off, the assistant cannot call <code>web_search</code> or <code>web_fetch</code>.
            </p>
          </div>
          <div class="field" class:disabled={!webEnabled}>
            <label for="allowed-domains">Allowed domains</label>
            <textarea
              id="allowed-domains"
              rows="3"
              bind:value={allowedDomainsText}
              disabled={!webEnabled}
              placeholder="One domain per line (e.g. arxiv.org)"
            ></textarea>
            <p class="hint">
              If any domains are listed, web searches are restricted to them.
              Leave blank to search the whole web.
            </p>
          </div>
          <div class="field" class:disabled={!webEnabled}>
            <label for="blocked-domains">Blocked domains</label>
            <textarea
              id="blocked-domains"
              rows="3"
              bind:value={blockedDomainsText}
              disabled={!webEnabled}
              placeholder="One domain per line"
            ></textarea>
            <p class="hint">
              Ignored when an allowlist is set. The API accepts one or the other.
            </p>
          </div>

        {:else if activeTab === 'ai'}
          <div class="field">
            <label for="model">Default model</label>
            <select id="model" bind:value={model}>
              {#each MODEL_OPTIONS as m}
                <option value={m.value}>{m.label}</option>
              {/each}
            </select>
          </div>
          <div class="field">
            <div class="api-key-status" class:saved={apiKeyStatus === 'set' && !clearApiKey}>
              {#if apiKeyStatus === 'unknown'}
                Loading…
              {:else if clearApiKey}
                API key will be cleared on save
              {:else if apiKeyStatus === 'set'}
                ✓ API key saved
              {:else}
                No API key set
              {/if}
            </div>
            <label for="api-key">
              Anthropic API key
            </label>
            <input
              id="api-key"
              type="password"
              bind:value={apiKeyInput}
              placeholder={apiKeyStatus === 'set' ? 'Type to replace existing key' : 'Enter Anthropic API key'}
              autocomplete="off"
              spellcheck="false"
              autocapitalize="off"
              oncopy={(e) => e.preventDefault()}
              oncut={(e) => e.preventDefault()}
              oncontextmenu={(e) => e.preventDefault()}
              disabled={clearApiKey}
            />
            <p class="hint">
              Keys are stored in your user data directory. The saved value is never displayed back.
              You can also set <code>ANTHROPIC_API_KEY</code> as an environment variable.
            </p>
            {#if apiKeyStatus === 'set' && !clearApiKey}
              <button class="link-btn" onclick={() => { clearApiKey = true; apiKeyInput = ''; }}>
                Clear saved key
              </button>
            {:else if clearApiKey}
              <button class="link-btn" onclick={() => { clearApiKey = false; }}>
                Cancel clear
              </button>
            {/if}
          </div>
        {/if}
      </section>
    </div>
    <footer>
      <button class="btn secondary" onclick={onClose}>Cancel</button>
      <button class="btn primary" onclick={handleDone}>Done</button>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dialog {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    min-width: 560px;
    max-width: 720px;
    min-height: 420px;
    max-height: 80vh;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
  }

  .body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .tabs {
    width: 140px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    background: var(--bg);
    flex-shrink: 0;
  }

  .tab {
    text-align: left;
    padding: 7px 14px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    border-left: 2px solid transparent;
  }

  .tab:hover {
    background: var(--bg-button);
  }

  .tab.active {
    background: var(--bg-button-hover);
    border-left-color: var(--accent);
    color: var(--text);
  }

  .panel {
    flex: 1;
    padding: 16px 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text);
    font-size: 12px;
  }

  .field.disabled label,
  .field.disabled .hint {
    opacity: 0.5;
  }

  .field label {
    color: var(--text);
  }

  .field.checkbox label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
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

  .field input[type="password"],
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

  .field input[type="password"]:focus,
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

  kbd {
    background: var(--bg-button);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0 4px;
    font-size: 10px;
    font-family: ui-monospace, monospace;
  }

  .confirm-rows {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .confirm-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
  }

  .confirm-row.muted {
    background: transparent;
    opacity: 0.7;
  }

  .confirm-text {
    flex: 1;
    min-width: 0;
  }

  .confirm-title {
    font-size: 12px;
    color: var(--text);
    font-weight: 500;
  }

  .confirm-desc {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
    margin-top: 2px;
  }

  .confirm-desc.mono {
    font-family: ui-monospace, monospace;
  }

  .confirm-status {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-muted);
    align-self: center;
  }

  .btn.small {
    padding: 3px 10px;
    font-size: 11px;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .api-key-status {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .api-key-status.saved {
    color: var(--accent);
  }

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

  .link-btn:hover {
    color: var(--text);
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
  }

  .btn {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .secondary {
    background: var(--bg-button);
    color: var(--text);
  }

  .secondary:hover {
    background: var(--bg-button-hover);
  }

  .primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .primary:hover {
    opacity: 0.9;
  }
</style>
