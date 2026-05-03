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
  import type { LLMSettings } from '../../../shared/tools/types';
  import { getConfirmSuppressionStore } from '../stores/confirm-suppression.svelte';
  import { CONFIRM_REGISTRY, confirmRegistryEntry } from '../confirm-keys';
  import {
    getRefactorSettings,
    setRefactorSettings,
    type DestinationMode,
    type RefactorSettings,
  } from '../refactor/settings';
  import {
    getSidebarSettings,
    setSidebarSettings,
    type SidebarSettings,
  } from '../sidebar/settings';
  import {
    getFormatSettings,
    setFormatSettings,
  } from '../formatter/settings';
  import {
    listRulesByCategory,
    CATEGORY_ORDER,
  } from '../../../shared/formatter/registry';
  import '../../../shared/formatter/rules/index';
  import type { FormatSettings } from '../../../shared/formatter/engine';
  import { MODEL_OPTIONS, modelLabel } from '../../../shared/tools/models';
  import { getAllToolInfos } from '../tools/tool-registry';
  import type { ThinkingToolInfo } from '../../../shared/tools/types';

  interface Props {
    onApplyEditor: (s: EditorSettings) => void;
    onThemeChanged: () => void;
    onClose: () => void;
  }

  let { onApplyEditor, onThemeChanged, onClose }: Props = $props();

  type TabId = 'editor' | 'appearance' | 'behaviors' | 'refactoring' | 'formatter' | 'web' | 'sites' | 'bibliography' | 'compute' | 'ai';
  const TABS: { id: TabId; label: string }[] = [
    { id: 'editor', label: 'Editor' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'behaviors', label: 'Behaviors' },
    { id: 'refactoring', label: 'Refactoring' },
    { id: 'formatter', label: 'Formatter' },
    { id: 'web', label: 'Web' },
    { id: 'sites', label: 'Sites' },
    { id: 'bibliography', label: 'Bibliography' },
    { id: 'compute', label: 'Compute' },
    { id: 'ai', label: 'AI' },
  ];

  let refactor = $state<RefactorSettings>({ ...getRefactorSettings() });
  function patchRefactor(patch: Partial<RefactorSettings>): void {
    refactor = { ...refactor, ...patch };
    setRefactorSettings(patch);
  }

  let sidebar = $state<SidebarSettings>({ ...getSidebarSettings() });
  function patchSidebar(patch: Partial<SidebarSettings>): void {
    sidebar = { ...sidebar, ...patch };
    setSidebarSettings(patch);
  }

  // Formatter settings (#154). Mirror the persisted map into local state so
  // the Done-close reset path can rehydrate without an IPC round-trip.
  let formatter = $state<FormatSettings>({
    enabled: { ...getFormatSettings().enabled },
    configs: { ...getFormatSettings().configs },
  });
  function toggleFormatterRule(id: string, on: boolean): void {
    formatter = {
      enabled: { ...formatter.enabled, [id]: on },
      configs: formatter.configs,
    };
    setFormatSettings({ enabled: { [id]: on } });
  }
  const FORMATTER_CATEGORY_LABELS: Record<string, string> = {
    yaml: 'YAML frontmatter',
    heading: 'Headings',
    content: 'Content',
    footnote: 'Footnotes',
    spacing: 'Spacing',
    minerva: 'Minerva-specific',
  };
  const formatterSections = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: FORMATTER_CATEGORY_LABELS[cat] ?? cat,
    rules: listRulesByCategory(cat),
  }));
  const hasAnyFormatterRules = formatterSections.some((s) => s.rules.length > 0);
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

  // Privileged sites (#NEW). Loaded from main, mutated via api.sites.*.
  let sites = $state<import('../../../shared/types').PrivilegedSite[]>([]);
  let newSiteDomain = $state('');
  let newSiteLabel = $state('');
  let siteBusyId = $state<string | null>(null);

  async function reloadSites(): Promise<void> {
    try {
      sites = await api.sites.list();
    } catch (e) {
      console.error('[settings] failed to load sites:', e);
    }
  }

  async function addSite(): Promise<void> {
    const domain = newSiteDomain.trim();
    if (!domain) return;
    try {
      await api.sites.add(domain, newSiteLabel.trim() || undefined);
      newSiteDomain = '';
      newSiteLabel = '';
      await reloadSites();
    } catch (e) {
      console.error('[settings] addSite failed:', e);
    }
  }

  async function loginSite(id: string): Promise<void> {
    siteBusyId = id;
    try {
      await api.sites.login(id);
      await reloadSites();
    } finally {
      siteBusyId = null;
    }
  }

  async function logoutSite(id: string): Promise<void> {
    await api.sites.logout(id);
    await reloadSites();
  }

  async function removeSite(id: string): Promise<void> {
    await api.sites.remove(id);
    await reloadSites();
  }

  function formatLastLogin(iso: string | null): string {
    if (!iso) return 'never';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  // Bibliography style (per-project, persisted in .minerva/config.json).
  let bibliographyStyles = $state<{ id: string; label: string; isUser?: boolean }[]>([]);
  let bibliographyStyleId = $state('apa');
  // User-imported CSL assets (#302) — project-scoped under .minerva/.
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
      console.error('[settings] failed to load bibliography settings:', e);
    }
  }

  async function setBibliographyStyle(next: string): Promise<void> {
    bibliographyStyleId = next;
    try {
      await api.bibliography.setStyle(next);
    } catch (e) {
      console.error('[settings] failed to save bibliography style:', e);
    }
  }

  async function importUserStyle(): Promise<void> {
    cslImportError = null;
    cslImporting = true;
    try {
      const result = await api.csl.importStyle();
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
      const result = await api.csl.importLocale();
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
      await api.csl.removeStyle(id);
      await loadBibliographySettings();
    } catch (e) {
      cslImportError = e instanceof Error ? e.message : String(e);
    }
  }

  async function removeUserLocale(id: string): Promise<void> {
    cslImportError = null;
    try {
      await api.csl.removeLocale(id);
      await loadBibliographySettings();
    } catch (e) {
      cslImportError = e instanceof Error ? e.message : String(e);
    }
  }

  // Web + AI settings (async-loaded from main process)
  let webEnabled = $state(true);
  let allowedDomainsText = $state('');
  let blockedDomainsText = $state('');
  let model = $state('claude-sonnet-4-6');
  let apiKeyInput = $state('');
  let apiKeyStatus = $state<'unknown' | 'set' | 'unset'>('unknown');
  let clearApiKey = $state(false);

  // Keep the dialog's own copy of saved LLM settings for Done-time diffing.
  let loadedLlm: LLMSettings | null = null;
  let toolModelOverrides = $state<Record<string, string>>({});
  const allTools: ThinkingToolInfo[] = getAllToolInfos();

  // Compute (#374): per-machine Python interpreter override.
  let pythonPathInput = $state('');
  /** What's saved to disk; used to detect dirty state. */
  let pythonPathSaved = $state('');
  let pythonProbe = $state<{ ok: boolean; path: string; version?: string; error?: string } | null>(null);
  let pythonProbing = $state(false);

  async function loadComputeSettings(): Promise<void> {
    try {
      const s = await api.compute.getPythonSettings();
      pythonPathInput = s.pythonPath;
      pythonPathSaved = s.pythonPath;
      // Probe whatever the resolver would currently pick so the
      // status line reflects the live state, not just the override.
      await refreshPythonProbe();
    } catch (e) {
      console.error('[settings] failed to load python settings:', e);
    }
  }

  async function refreshPythonProbe(): Promise<void> {
    pythonProbing = true;
    try {
      // Empty `pythonPathInput` → probe the resolver's active pick
      // (env var or `python3`). Non-empty → probe the input directly
      // so the status line shows whether the candidate would work.
      pythonProbe = await api.compute.probePython(pythonPathInput.trim() || undefined);
    } catch (e) {
      pythonProbe = { ok: false, path: pythonPathInput, error: e instanceof Error ? e.message : String(e) };
    } finally {
      pythonProbing = false;
    }
  }

  async function browsePythonInterpreter(): Promise<void> {
    const picked = await api.compute.browsePython();
    if (!picked) return;
    pythonPathInput = picked;
    // Probe immediately so the user gets instant feedback on whether
    // the picked file is actually a runnable Python.
    await refreshPythonProbe();
  }

  async function savePythonPath(): Promise<void> {
    try {
      await api.compute.setPythonSettings({ pythonPath: pythonPathInput.trim() });
      pythonPathSaved = pythonPathInput.trim();
      await refreshPythonProbe();
    } catch (e) {
      pythonProbe = { ok: false, path: pythonPathInput, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function restartPythonKernelFromSettings(): Promise<void> {
    try {
      await api.compute.restartPythonKernel();
    } catch (e) {
      console.error('[settings] failed to restart python kernel:', e);
    }
  }

  onMount(async () => {
    try {
      const s = await api.tools.getSettings();
      loadedLlm = s;
      model = s.model;
      apiKeyStatus = s.apiKey ? 'set' : 'unset';
      const web = s.web ?? { enabled: true, allowedDomains: [], blockedDomains: [] };
      webEnabled = web.enabled;
      allowedDomainsText = web.allowedDomains.join('\n');
      blockedDomainsText = web.blockedDomains.join('\n');
      toolModelOverrides = { ...(s.toolModelOverrides ?? {}) };
    } catch (e) {
      console.error('[settings] failed to load LLM settings:', e);
    }
    await reloadSites();
    await loadBibliographySettings();
    await loadComputeSettings();
  });

  function setToolOverride(toolId: string, value: string) {
    const next = { ...toolModelOverrides };
    if (value) next[toolId] = value;
    else delete next[toolId];
    toolModelOverrides = next;
  }

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
      ...(Object.keys(toolModelOverrides).length > 0 ? { toolModelOverrides } : {}),
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
          <div class="field checkbox">
            <label>
              <input
                type="checkbox"
                checked={sidebar.autoReveal}
                onchange={(e) => patchSidebar({ autoReveal: e.currentTarget.checked })}
              />
              Auto-reveal active file in sidebar
            </label>
            <p class="hint">
              When the active editor changes, scroll the matching row into view in the
              Notes panel and expand its parent folders. Never collapses anything you've
              already opened.
            </p>
          </div>
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

        {:else if activeTab === 'formatter'}
          <p class="section-intro">
            Deterministic normalizations applied by the <strong>Refactor ▸ Format</strong> commands.
            Rules are off by default — turn on the ones whose aesthetics you want
            enforced. Choices are stored in
            <code>.minerva/formatter.json</code> so they travel with the thoughtbase.
          </p>

          {#if !hasAnyFormatterRules}
            <div class="empty-state">
              No formatter rules are registered yet. Rule sets land per category
              in follow-up tickets (#155–#161); once any of those merge, rules
              appear here as rows you can enable.
            </div>
          {/if}

          {#each formatterSections as section}
            {#if section.rules.length > 0}
              <h3 class="fm-category">{section.label}</h3>
              <div class="fm-rules">
                {#each section.rules as rule (rule.id)}
                  <div class="field checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={!!formatter.enabled[rule.id]}
                        onchange={(e) => toggleFormatterRule(rule.id, e.currentTarget.checked)}
                      />
                      {rule.title}
                    </label>
                    <p class="hint">{rule.description}</p>
                  </div>
                {/each}
              </div>
            {/if}
          {/each}

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

        {:else if activeTab === 'sites'}
          <div class="field">
            <p class="hint">
              Add sites you have a login for (institutional access, paid
              subscriptions, etc.). Minerva will route ingest fetches to those
              domains through your in-app browser session, so the response
              reflects what you can see when logged in.
            </p>
          </div>
          <div class="field">
            <label for="new-site-domain">Add site</label>
            <div class="site-add-row">
              <input
                id="new-site-domain"
                type="text"
                bind:value={newSiteDomain}
                placeholder="arxiv.org"
              />
              <input
                type="text"
                bind:value={newSiteLabel}
                placeholder="Label (optional)"
              />
              <button onclick={addSite} disabled={!newSiteDomain.trim()}>Add</button>
            </div>
          </div>
          <div class="field">
            {#if sites.length === 0}
              <p class="hint">No sites configured.</p>
            {:else}
              <ul class="sites-list">
                {#each sites as site (site.id)}
                  <li class="site-row">
                    <div class="site-info">
                      <div class="site-label">{site.label}</div>
                      <div class="site-meta">
                        {site.domain} · last login: {formatLastLogin(site.lastLoginAt)}
                      </div>
                    </div>
                    <div class="site-actions">
                      <button
                        onclick={() => loginSite(site.id)}
                        disabled={siteBusyId === site.id}
                        title="Open a browser window for this domain so you can log in"
                      >Login</button>
                      <button
                        onclick={() => logoutSite(site.id)}
                        title="Clear cookies for this site"
                      >Logout</button>
                      <button
                        onclick={() => removeSite(site.id)}
                        title="Remove site and clear its cookies"
                      >Remove</button>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

        {:else if activeTab === 'bibliography'}
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
            <label>Imported styles</label>
            <p class="hint">
              Drop additional <code>.csl</code> files into your project under
              <code>.minerva/csl-styles/</code> — they show up in the picker above and
              in the Export dialog. The Zotero Style Repository at
              <code>zotero.org/styles</code> publishes 10,000+ open styles.
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
            <label>Imported locales</label>
            <p class="hint">
              Optional. Bundled locale is en-US; import additional CSL
              locale XML to render bibliographies in another language.
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

        {:else if activeTab === 'compute'}
          <div class="field">
            <label for="python-path">Python interpreter</label>
            <p class="hint">
              Path to the Python executable Minerva should use for cell
              execution. Leave empty to fall back to the
              <code>MINERVA_PYTHON</code> environment variable, then to
              <code>python3</code> on <code>$PATH</code>. Stored
              per-machine — different projects on this machine share the
              same interpreter.
            </p>
            <div class="path-row">
              <input
                id="python-path"
                type="text"
                bind:value={pythonPathInput}
                placeholder="/Users/you/.minerva-venv/bin/python"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="off"
              />
              <button
                class="action-btn"
                onclick={() => { void browsePythonInterpreter(); }}
                disabled={pythonProbing}
              >
                Browse…
              </button>
              <button
                class="action-btn"
                onclick={() => { void refreshPythonProbe(); }}
                disabled={pythonProbing}
                title="Test the interpreter — runs `python --version`"
              >
                {pythonProbing ? 'Probing…' : 'Probe'}
              </button>
            </div>

            {#if pythonProbe}
              <div class="probe-result" class:probe-ok={pythonProbe.ok} class:probe-error={!pythonProbe.ok}>
                {#if pythonProbe.ok}
                  <strong>{pythonProbe.version}</strong>
                  <span class="probe-path">at <code>{pythonProbe.path}</code></span>
                {:else}
                  <strong>Couldn't run interpreter:</strong>
                  <span class="probe-path">{pythonProbe.error}</span>
                {/if}
              </div>
            {/if}

            <div class="action-row">
              <button
                class="action-btn primary"
                onclick={() => { void savePythonPath(); }}
                disabled={pythonProbing || pythonPathInput.trim() === pythonPathSaved}
              >
                Save
              </button>
              <button
                class="action-btn"
                onclick={() => { void restartPythonKernelFromSettings(); }}
                title="Apply the new interpreter to a fresh kernel — wipes namespace state"
              >
                Save &amp; Restart Kernel
              </button>
              {#if pythonPathSaved}
                <button
                  class="link-btn"
                  onclick={() => { pythonPathInput = ''; void savePythonPath(); }}
                >
                  Clear override
                </button>
              {/if}
            </div>

            <p class="hint">
              Tip: a venv at <code>~/.minerva-venv/bin/python</code> with
              <code>pandas</code>, <code>matplotlib</code>, and
              <code>pillow</code> installed gives you the full rich-output
              pipeline. After changing the interpreter, click
              <em>Save &amp; Restart Kernel</em> so the next cell runs
              against the new env.
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
          <div class="field">
            <label>Tool model overrides</label>
            <p class="hint">
              Each tool's author may suggest a preferred model. You can override that
              per tool. Empty override → use the tool's preference; no preference →
              fall back to the default model above.
            </p>
            {#if allTools.length === 0}
              <p class="hint">No tools registered.</p>
            {:else}
              <table class="tool-models">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Tool preference</th>
                    <th>Your override</th>
                  </tr>
                </thead>
                <tbody>
                  {#each allTools as t}
                    <tr>
                      <td>{t.name}</td>
                      <td class="muted">{t.preferredModel ? modelLabel(t.preferredModel) : '—'}</td>
                      <td>
                        <select
                          value={toolModelOverrides[t.id] ?? ''}
                          onchange={(e) => setToolOverride(t.id, e.currentTarget.value)}
                        >
                          <option value="">Use tool preference</option>
                          {#each MODEL_OPTIONS as m}
                            <option value={m.value}>{m.label}</option>
                          {/each}
                        </select>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
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

  .tool-models {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .tool-models th,
  .tool-models td {
    text-align: left;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
  }

  .tool-models th {
    font-weight: 600;
    color: var(--text-muted);
    font-size: 11px;
  }

  .tool-models td.muted {
    color: var(--text-muted);
  }

  .tool-models select {
    padding: 3px 6px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    max-width: 170px;
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

  .section-intro {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0 0 16px 0;
  }

  /* User-imported CSL assets list (#302). Mirrors the privileged-sites
     style — each row shows a label, id, and a Remove action. */
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
  .action-btn:hover:not(:disabled) {
    background: var(--bg-button-hover);
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
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

  /* Compute panel — Python interpreter row + probe status (#374). */
  .path-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 6px 0;
  }
  .path-row input[type="text"] {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
  }
  .probe-result {
    padding: 6px 10px;
    border-left: 3px solid var(--border);
    background: var(--bg-button);
    font-size: 12px;
    margin: 6px 0;
    border-radius: 0 3px 3px 0;
  }
  .probe-result.probe-ok { border-left-color: var(--accent); }
  .probe-result.probe-error { border-left-color: var(--accent); }
  .probe-result strong { display: block; margin-bottom: 2px; }
  .probe-result .probe-path {
    color: var(--text-muted);
    font-size: 11px;
  }
  .probe-result code {
    font-size: 11px;
    background: var(--bg);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .action-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 8px 0;
  }
  .action-btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
    font-weight: 500;
  }
  .action-btn.primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .section-intro code {
    font-size: 11px;
    color: var(--text);
  }

  .empty-state {
    padding: 12px;
    border: 1px dashed var(--border);
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .fm-category {
    margin: 18px 0 8px 0;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .fm-rules {
    display: flex;
    flex-direction: column;
    gap: 10px;
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

  .site-add-row {
    display: flex;
    gap: 6px;
  }
  .site-add-row input {
    flex: 1;
    min-width: 0;
  }
  .sites-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .site-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .site-info {
    flex: 1;
    min-width: 0;
  }
  .site-label {
    font-size: 13px;
    color: var(--text);
  }
  .site-meta {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .site-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
</style>
