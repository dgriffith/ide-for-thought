<script lang="ts">
  import { onMount } from 'svelte';
  import { getEditorSettings, type EditorSettings } from '../editor/settings';
  import { api } from '../ipc/client';
  import type { LLMSettingsUpdate } from '../../../shared/tools/types';
  import { getSettingsStore } from '../stores/settings.svelte';
  import { makePatch } from '../make-patch';
  import BehaviorsSettings from './BehaviorsSettings.svelte';
  import EditorSettingsPanel from './EditorSettings.svelte';
  import AppearanceSettings from './AppearanceSettings.svelte';
  import WebSettings from './WebSettings.svelte';
  import FormatterSettings from './FormatterSettings.svelte';
  import ClipperSettings from './ClipperSettings.svelte';
  import SourcesSettings from './SourcesSettings.svelte';
  import {
    getRefactorSettings,
    setRefactorSettings,
    type DestinationMode,
    type RefactorSettings,
  } from '../refactor/settings';
  import ComputeSettings from './ComputeSettings.svelte';
  import SkillsSettings from './SkillsSettings.svelte';
  import ObjectTypesSettings from './ObjectTypesSettings.svelte';
  import BibliographySettings from './BibliographySettings.svelte';
  import AiSettings from './AiSettings.svelte';
  import { DEFAULT_MODEL } from '../../../shared/tools/models';
  import { PROVIDERS, PROVIDER_IDS, type ProviderId } from '../../../shared/tools/providers';
  import type { ProviderConfigView, ProviderCredentialsUpdate, CustomModel } from '../../../shared/tools/types';

  /** Per-provider input state; matches AiSettings's structural shape. */
  interface ProviderInput { key: string; baseURL: string; clear: boolean }

  /** Fresh, empty per-provider input state (BYOM #1498). */
  function emptyProviderInputs(): Record<ProviderId, ProviderInput> {
    return Object.fromEntries(
      PROVIDER_IDS.map((id) => [id, { key: '', baseURL: '', clear: false }]),
    ) as Record<ProviderId, ProviderInput>;
  }

  interface Props {
    onApplyEditor: (s: EditorSettings) => void;
    /** Apply an absolute editor font size (px) — the Appearance panel's numeric
     *  control. App reconfigures the live editor(s) + persists. */
    onApplyFontSize: (px: number) => void;
    onThemeChanged: () => void;
    onClose: () => void;
    /** Tab to land on when the dialog opens. Defaults to 'editor'. The
     *  missing-API-key flow passes 'ai' so the user lands on the key
     *  field directly instead of hunting through tabs. */
    initialTab?: TabId | undefined;
  }

  let { onApplyEditor, onApplyFontSize, onThemeChanged, onClose, initialTab }: Props = $props();

  type TabId = 'editor' | 'appearance' | 'behaviors' | 'notes' | 'formatter' | 'objectTypes' | 'web' | 'sources' | 'clipper' | 'bibliography' | 'compute' | 'ai' | 'skills';

  /** Restructure per IMPLEMENTATION.md §10.4 — 10 flat tabs become 4
   *  semantic groups. Group labels render in mono-uppercase above each
   *  cluster in the sidebar. Sub-lines describe what each tab covers. */
  interface TabDef {
    id: TabId;
    label: string;
    sub: string;
  }
  interface GroupDef {
    label: string;
    items: ReadonlyArray<TabDef>;
  }
  const SETTINGS_GROUPS: ReadonlyArray<GroupDef> = [
    {
      label: 'Workspace',
      items: [
        { id: 'editor',     label: 'Editor',     sub: 'Tab size · word wrap · line numbers' },
        { id: 'appearance', label: 'Appearance', sub: 'Theme · font · density' },
        { id: 'behaviors',  label: 'Behaviors',  sub: 'Confirm dialogs · sidebar' },
      ],
    },
    {
      label: 'Authoring',
      items: [
        { id: 'notes',        label: 'Notes',        sub: 'Refactoring · excerpt destinations' },
        { id: 'formatter',    label: 'Formatter',    sub: 'House style · format rules' },
        { id: 'objectTypes',  label: 'Object Types', sub: 'Create · delete · duplicate types' },
        { id: 'bibliography', label: 'Bibliography', sub: 'Citation style · locale' },
      ],
    },
    {
      label: 'Ingest & compute',
      items: [
        { id: 'web',     label: 'Web',     sub: 'Default ingest rules' },
        { id: 'sources', label: 'Sources', sub: 'Identifier lookups · privileged logins' },
        { id: 'clipper', label: 'Browser Clipper', sub: 'Enable · pairing code · status' },
        { id: 'compute', label: 'Compute', sub: 'Python interpreter · trust' },
      ],
    },
    {
      label: 'AI',
      items: [
        { id: 'ai', label: 'AI', sub: 'Model · API key · tool prefs' },
        { id: 'skills', label: 'Skills', sub: 'Conversation skills · import' },
      ],
    },
  ];

  /** Reverse lookup: tab → its containing group label. Used for the
   *  body-section eyebrow above each panel's content. */
  const TAB_TO_GROUP: ReadonlyMap<TabId, string> = new Map(
    SETTINGS_GROUPS.flatMap((g) => g.items.map((t) => [t.id, g.label] as const)),
  );
  const TAB_DEFS: ReadonlyMap<TabId, TabDef> = new Map(
    SETTINGS_GROUPS.flatMap((g) => g.items.map((t) => [t.id, t] as const)),
  );

  // A "patch" merges a delta into the local $state mirror AND persists it
  // per-change (unlike the Done-batched editor/appearance/web/ai). #1600.
  let refactor = $state<RefactorSettings>({ ...getRefactorSettings() });
  const patchRefactor = makePatch(() => refactor, (v) => { refactor = v; }, setRefactorSettings);
  // sidebar / breadcrumbs / conversations toggles + the confirm-suppression list
  // now live in BehaviorsSettings.svelte (self-contained, per-change).

  const DESTINATION_OPTIONS: { value: DestinationMode; label: string }[] = [
    { value: 'same-folder', label: 'Same folder as source note' },
    { value: 'root', label: 'Thoughtbase root' },
    { value: 'custom', label: 'Custom folder (template)' },
  ];

  const settings = getSettingsStore();
  // Intentional one-time seed from `initialTab`; dialog is short-lived and keyed.
  // svelte-ignore state_referenced_locally
  let activeTab = $state<TabId>(initialTab ?? 'editor');

  // Editor settings
  let editor = $state<EditorSettings>(getEditorSettings());


  // Privileged sites now live in SitesSettings.svelte (self-contained panel).

  // Excerpt → Note default folder (#101). Empty string = project root.
  let excerptNoteFolder = $state('');

  async function loadExcerptSettings(): Promise<void> {
    try {
      excerptNoteFolder = await api.sources.getExcerptNoteFolder();
    } catch (e) {
      console.error('[settings] failed to load excerpt settings:', e);
    }
  }

  async function commitExcerptNoteFolder(next: string): Promise<void> {
    excerptNoteFolder = next;
    try {
      await settings.setExcerptNoteFolder(next);
    } catch (e) {
      console.error('[settings] failed to save excerpt folder:', e);
    }
  }

  // Bibliography (#302) + Skills (#629) now live in their own panel components
  // (BibliographySettings.svelte / SkillsSettings.svelte).

  // Web + AI settings (async-loaded from main process)
  let webEnabled = $state(true);
  let allowedDomainsText = $state('');
  let blockedDomainsText = $state('');
  // Ingest settings — per-machine, used by identifier ingest paths (#473).
  let importUpstreamTags = $state(true);
  let model = $state(DEFAULT_MODEL);
  let effort = $state<import('../../../shared/tools/effort').Effort | undefined>(undefined);
  // Per-provider credential inputs + loaded status (BYOM #1498).
  let providerInputs = $state<Record<ProviderId, ProviderInput>>(emptyProviderInputs());
  let providerViews = $state<Partial<Record<ProviderId, ProviderConfigView>>>({});
  let secureStorageAvailable = $state(false);
  let customModels = $state<CustomModel[]>([]);

  let toolModelOverrides = $state<Record<string, string>>({});

  // Compute (#374): the Python-interpreter panel now lives in
  // ComputeSettings.svelte (self-contained).

  onMount(async () => {
    try {
      const s = await api.tools.getSettings();
      model = s.model;
      effort = s.effort;
      providerViews = s.providers ?? {};
      customModels = s.customModels ? [...s.customModels] : [];
      // Prefill base-URL inputs from stored config so the user sees/edits them.
      for (const id of PROVIDER_IDS) {
        providerInputs[id].baseURL = s.providers?.[id]?.baseURL ?? '';
      }
      try {
        secureStorageAvailable = (await api.tools.getKeyStorage()).available;
      } catch (e) {
        console.error('[settings] failed to load key storage status:', e);
      }
      const web = s.web ?? { enabled: true, allowedDomains: [], blockedDomains: [] };
      webEnabled = web.enabled;
      allowedDomainsText = web.allowedDomains.join('\n');
      blockedDomainsText = web.blockedDomains.join('\n');
      toolModelOverrides = { ...(s.toolModelOverrides ?? {}) };
    } catch (e) {
      console.error('[settings] failed to load LLM settings:', e);
    }
    await loadExcerptSettings();
    try {
      const ingest = await api.sources.getIngestSettings();
      importUpstreamTags = ingest.importUpstreamTags;
    } catch (e) {
      console.error('[settings] failed to load ingest settings:', e);
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

    // Web + AI — build the settings update and save. Per-provider keys are
    // tri-state (BYOM #1498): clear → '', a typed value → that key, otherwise
    // OMIT so main preserves the stored key without decrypting; base URLs send
    // their current value (trimmed; '' clears).
    const providerUpdates: Partial<Record<ProviderId, ProviderCredentialsUpdate>> = {};
    for (const id of PROVIDER_IDS) {
      const meta = PROVIDERS[id];
      const inp = providerInputs[id];
      const upd: ProviderCredentialsUpdate = {};
      if (meta.requiresKey) {
        if (inp.clear) upd.apiKey = '';
        else if (inp.key) upd.apiKey = inp.key;
      }
      if (meta.usesBaseURL) upd.baseURL = inp.baseURL.trim();
      if (Object.keys(upd).length > 0) providerUpdates[id] = upd;
    }
    const next: LLMSettingsUpdate = {
      model,
      web: {
        enabled: webEnabled,
        allowedDomains: parseDomains(allowedDomainsText),
        blockedDomains: parseDomains(blockedDomainsText),
      },
      ...(effort ? { effort } : {}),
      ...(Object.keys(toolModelOverrides).length > 0 ? { toolModelOverrides } : {}),
      ...(Object.keys(providerUpdates).length > 0 ? { providers: providerUpdates } : {}),
      customModels,
    };
    try {
      await settings.setToolSettings(next);
    } catch (e) {
      console.error('[settings] failed to save LLM settings:', e);
    }

    try {
      await settings.setIngestSettings({ importUpstreamTags });
    } catch (e) {
      console.error('[settings] failed to save ingest settings:', e);
    }

    onClose();
  }

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
        {#each SETTINGS_GROUPS as group}
          <div class="tab-group">
            <div class="tab-group-label">{group.label}</div>
            {#each group.items as tab (tab.id)}
              <button
                class="tab"
                class:active={activeTab === tab.id}
                onclick={() => { activeTab = tab.id; }}
              >
                <span class="tab-label">{tab.label}</span>
                <span class="tab-sub">{tab.sub}</span>
              </button>
            {/each}
          </div>
        {/each}
      </nav>
      <section class="panel">
        {#if TAB_DEFS.get(activeTab)}
          {@const def = TAB_DEFS.get(activeTab)!}
          <div class="panel-header">
            <div class="panel-eyebrow">{TAB_TO_GROUP.get(activeTab) ?? ''}</div>
            <h3 class="panel-title">{def.label}</h3>
            <p class="panel-sub">{def.sub}</p>
          </div>
        {/if}
        {#if activeTab === 'editor'}
          <EditorSettingsPanel bind:editor />

        {:else if activeTab === 'appearance'}
          <AppearanceSettings {onApplyFontSize} {onThemeChanged} />

        {:else if activeTab === 'behaviors'}
          <BehaviorsSettings />

        {:else if activeTab === 'notes'}
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

        {:else if activeTab === 'formatter'}
          <FormatterSettings />

        {:else if activeTab === 'web'}
          <WebSettings bind:webEnabled bind:allowedDomainsText bind:blockedDomainsText />

        {:else if activeTab === 'sources'}
          <SourcesSettings bind:importUpstreamTags />

        {:else if activeTab === 'clipper'}
          <ClipperSettings />

        {:else if activeTab === 'objectTypes'}
          <ObjectTypesSettings />

        {:else if activeTab === 'bibliography'}
          <BibliographySettings />

        {:else if activeTab === 'skills'}
          <SkillsSettings bind:toolModelOverrides defaultModel={model} {customModels} />

        {:else if activeTab === 'compute'}
          <ComputeSettings />

        {:else if activeTab === 'ai'}
          <AiSettings
            bind:model
            bind:effort
            bind:providerInputs
            bind:customModels
            {providerViews}
            {secureStorageAvailable}
            onCheckConnection={(providerId, candidateKey, baseURL) => api.tools.checkConnection(providerId, candidateKey, baseURL)}
          />
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
    background: rgba(20, 14, 6, 0.5);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }

  /* Adopt the §10 dialog shell: 12px radius, --bg-elev with
     --border-strong, layered shadow with inset highlight. */
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    /* Fixed width so the dialog doesn't shrink-wrap to each panel's
       content — otherwise narrower panels (the self-contained sub-panels
       whose fields don't fill the row) resize the whole dialog as you
       switch tabs. Clamp to the viewport on small screens. */
    width: 880px;
    max-width: calc(100vw - 64px);
    min-height: 420px;
    max-height: calc(100vh - 64px);
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    color: var(--text);
  }

  header {
    padding: 18px 22px 12px;
  }

  header h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 500;
    letter-spacing: -0.005em;
    color: var(--text);
  }

  .body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .tabs {
    width: 200px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 12px 0;
    background: var(--bg);
    flex-shrink: 0;
    overflow-y: auto;
  }

  /* Group cluster per §10.4 — mono-uppercase label above its tabs. */
  .tab-group {
    display: flex;
    flex-direction: column;
    padding: 0 0 8px;
  }
  .tab-group + .tab-group {
    margin-top: 4px;
  }
  .tab-group-label {
    padding: 8px 16px 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* Tab rows show label + sub-line */
  .tab {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
    padding: 7px 16px 7px 18px;
    border: none;
    background: none;
    color: var(--text);
    font-family: var(--font-sans);
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  .tab:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
  }
  .tab.active {
    background: color-mix(in oklch, var(--accent) 12%, transparent);
    border-left-color: var(--accent);
    color: var(--text);
  }
  .tab-label {
    font-size: 12.5px;
    font-weight: 450;
  }
  .tab.active .tab-label {
    font-weight: 500;
    color: var(--accent);
  }
  .tab-sub {
    font-size: 10.5px;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .panel {
    flex: 1;
    padding: 20px 28px 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* Per-panel header — mono eyebrow + display-serif H1 + sub line.
     Matches the §10 header pattern. */
  .panel-header {
    margin-bottom: 8px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border);
  }
  .panel-eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .panel-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 500;
    letter-spacing: -0.01em;
    line-height: 1.15;
    color: var(--text);
  }
  .panel-sub {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: var(--text-muted);
  }

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

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
