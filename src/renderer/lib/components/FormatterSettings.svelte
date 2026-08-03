<script lang="ts">
  /**
   * Formatter settings panel (#1600) — extracted from SettingsDialog. Lists the
   * registered Refactor ▸ Format rules by category with per-rule toggles + a
   * "Restore house style" reset. Self-contained: each toggle persists
   * immediately via setFormatSettings (no Done-batch).
   */
  import {
    getFormatSettings,
    setFormatSettings,
    resetFormatToHouseStyle,
  } from '../formatter/settings';
  import {
    listRulesByCategory,
    CATEGORY_ORDER,
  } from '../../../shared/formatter/registry';
  import '../../../shared/formatter/rules/index';
  import { isRuleEnabled, type FormatSettings } from '../../../shared/formatter/engine';

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
  // True when nothing overrides the shipped defaults — no enable/disable
  // toggles and no per-rule config tuning. Both must be clear, or "Restore
  // house style" would stay disabled while a tuned config still lingered.
  let atHouseStyle = $derived(
    Object.keys(formatter.enabled).length === 0 &&
    Object.keys(formatter.configs).length === 0,
  );
  function restoreHouseStyle(): void {
    const next = resetFormatToHouseStyle();
    formatter = {
      enabled: { ...next.enabled },
      configs: { ...next.configs },
    };
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
</script>

<div class="formatter">
      <p class="section-intro">
        Deterministic normalizations applied by the <strong>Refactor ▸ Format</strong> commands.
        A curated <em>house style</em> — safe whitespace, frontmatter, and link
        tidying — is on by default; everything else is opt-in. Toggle any rule to
        override. Choices are stored in
        <code>.minerva/formatter.json</code> so they travel with the thoughtbase.
      </p>

      {#if !hasAnyFormatterRules}
        <div class="empty-state">
          No formatter rules are registered yet. Rule sets land per category
          in follow-up tickets (#155–#161); once any of those merge, rules
          appear here as rows you can enable.
        </div>
      {:else}
        <div class="fm-actions">
          <button
            class="btn secondary"
            disabled={atHouseStyle}
            onclick={restoreHouseStyle}
          >Restore house style</button>
          <span class="hint">Clears every override — rule toggles and per-rule tuning alike — back to the default curated set.</span>
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
                    checked={isRuleEnabled(formatter, rule.id)}
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
</div>

<style>
  .formatter { display: flex; flex-direction: column; gap: 14px; }
  .section-intro {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0 0 16px 0;
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
  .fm-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }
  .fm-actions .hint {
    margin: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text);
    font-size: 12px;
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
  .hint code {
    background: var(--bg-button);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
  }
  .btn {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .secondary {
    background: var(--bg-button);
    color: var(--text);
  }
  .secondary:hover {
    background: var(--bg-button-hover);
  }
</style>
