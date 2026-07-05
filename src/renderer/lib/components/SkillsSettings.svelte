<script lang="ts">
  /**
   * Skills settings panel (#629 / menu config #630, extracted from
   * SettingsDialog for #672).
   *
   * Self-contained: owns the skill catalog + per-machine menu config, loads on
   * mount, and drives everything through api.skills.*. Every change re-syncs the
   * renderer registry (registerSkillInfos) so the command palette + slash
   * commands track edits immediately — the same app-wide sync the panel did
   * inline before. (App.svelte already does the initial startup sync.)
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import type { SkillInfo, SkillMenu, SkillLoadError } from '../../../shared/skills/types';
  import { SKILL_MENUS } from '../../../shared/skills/types';
  import {
    applyMenuConfig,
    effectiveMenu,
    isSkillEnabled,
    skillsForMenu as orderedSkillsForMenu,
    emptyMenuConfig,
    type MenuConfig,
  } from '../../../shared/skills/menu-config';
  import { registerSkillInfos } from '../tools/tool-registry';
  import { MODEL_OPTIONS, modelLabel } from '../../../shared/tools/models';

  interface Props {
    /** Per-skill model override map (skill id → model id). Owned + persisted
     *  by SettingsDialog's Done handler alongside the API key + default model;
     *  bound here so each skill row can edit its own override inline. */
    toolModelOverrides: Record<string, string>;
    /** The global default model id. A skill with no override and no `model:`
     *  preference resolves to this, so the empty option names it instead of
     *  saying a bare "Default model". */
    defaultModel?: string;
  }
  let { toolModelOverrides = $bindable({}), defaultModel }: Props = $props();

  /** Label for a skill row's empty ("use the default") model option. The
   *  resolution order at run time is: this skill's `model:` preference, then
   *  the global default. Name whichever one applies so the row never shows a
   *  bare "Default model" with no indication of what that is. */
  function defaultOptionLabel(skillModel: string | undefined): string {
    const resolved = skillModel || defaultModel;
    return resolved ? `Default · ${modelLabel(resolved)}` : 'Default model';
  }

  function setToolOverride(skillId: string, value: string): void {
    const next = { ...toolModelOverrides };
    if (value) next[skillId] = value;
    else delete next[skillId];
    toolModelOverrides = next;
  }

  let skillCatalog = $state<{ skills: SkillInfo[]; errors: SkillLoadError[]; config: MenuConfig }>({
    skills: [],
    errors: [],
    config: emptyMenuConfig(),
  });
  let skillsBusy = $state(false);
  let skillsError = $state<string | null>(null);
  const SKILL_MENU_ORDER: readonly SkillMenu[] = SKILL_MENUS;

  /** Skills shown under a menu in Settings — includes disabled ones (you need
   *  to see a skill to turn it back on), in configured order, effective menu. */
  function skillsForMenu(menu: SkillMenu): SkillInfo[] {
    return orderedSkillsForMenu(skillCatalog.skills, skillCatalog.config, menu, true);
  }

  function skillEnabled(s: SkillInfo): boolean {
    return isSkillEnabled(s.id, skillCatalog.config);
  }

  /** Re-sync the renderer registry (palette / slash) from a config + persist it
   *  to main (which rebuilds the native menu). Optimistic: the UI updates first. */
  async function commitConfig(next: MenuConfig): Promise<void> {
    skillsError = null;
    skillCatalog = { ...skillCatalog, config: next };
    registerSkillInfos(applyMenuConfig(skillCatalog.skills, next));
    try {
      const saved = await api.skills.setMenuConfig($state.snapshot(next));
      skillCatalog = { ...skillCatalog, config: saved };
      registerSkillInfos(applyMenuConfig(skillCatalog.skills, saved));
    } catch (e) {
      skillsError = e instanceof Error ? e.message : String(e);
    }
  }

  function toggleSkillEnabled(s: SkillInfo): void {
    const cfg = skillCatalog.config;
    void commitConfig({
      skills: {
        ...cfg.skills,
        [s.id]: { enabled: !skillEnabled(s), menu: effectiveMenu(s, cfg) },
      },
      order: cfg.order,
    });
  }

  function reassignSkill(s: SkillInfo, menu: SkillMenu): void {
    const cfg = skillCatalog.config;
    if (effectiveMenu(s, cfg) === menu) return;
    void commitConfig({
      skills: { ...cfg.skills, [s.id]: { enabled: skillEnabled(s), menu } },
      order: cfg.order,
    });
  }

  function moveSkill(s: SkillInfo, menu: SkillMenu, dir: -1 | 1): void {
    const ids = skillsForMenu(menu).map((x) => x.id);
    const i = ids.indexOf(s.id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    const cfg = skillCatalog.config;
    void commitConfig({ skills: cfg.skills, order: { ...cfg.order, [menu]: ids } });
  }

  /** Refresh the catalog and re-sync the renderer registry so the command
   *  palette / slash commands track imports & removals too. */
  async function loadSkills(): Promise<void> {
    try {
      const cat = await api.skills.list();
      skillCatalog = cat;
      registerSkillInfos(applyMenuConfig(cat.skills, cat.config));
    } catch (e) {
      console.error('[settings] failed to load skills:', e);
    }
  }

  async function importSkill(): Promise<void> {
    skillsError = null;
    skillsBusy = true;
    try {
      const res = await api.skills.import();
      if (res) await loadSkills();
    } catch (e) {
      skillsError = e instanceof Error ? e.message : String(e);
    } finally {
      skillsBusy = false;
    }
  }

  async function removeSkill(id: string): Promise<void> {
    skillsError = null;
    skillsBusy = true;
    try {
      await api.skills.remove(id);
      await loadSkills();
    } catch (e) {
      skillsError = e instanceof Error ? e.message : String(e);
    } finally {
      skillsBusy = false;
    }
  }

  async function reloadSkills(): Promise<void> {
    skillsError = null;
    skillsBusy = true;
    try {
      const cat = await api.skills.reload();
      skillCatalog = cat;
      registerSkillInfos(applyMenuConfig(cat.skills, cat.config));
    } catch (e) {
      skillsError = e instanceof Error ? e.message : String(e);
    } finally {
      skillsBusy = false;
    }
  }

  async function revealSkills(): Promise<void> {
    try {
      await api.skills.revealFolder();
    } catch (e) {
      skillsError = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(loadSkills);
</script>

<div class="field">
  <span class="field-label">Skills</span>
  <p class="hint">
    Skills are markdown files that drive the Learning, Research, and
    Analysis menus. Built-in skills ship with Minerva; your own live in
    <code>~/.minerva/skills/</code> and apply across every thoughtbase.
    A skill is a single <code>.md</code> file (or a folder with a
    <code>SKILL.md</code>) — YAML frontmatter plus a prompt body.
  </p>
  <div class="skill-actions">
    <button class="action-btn" onclick={() => { void importSkill(); }} disabled={skillsBusy}>
      Import skill…
    </button>
    <button class="action-btn" onclick={() => { void revealSkills(); }}>
      Reveal skills folder
    </button>
    <button class="action-btn" onclick={() => { void reloadSkills(); }} disabled={skillsBusy}>
      Reload
    </button>
  </div>
</div>

{#if skillsError}
  <div class="csl-error">{skillsError}</div>
{/if}

{#if skillCatalog.errors.length > 0}
  <div class="field">
    <span class="field-label">Skills that failed to load</span>
    <ul class="skill-errs">
      {#each skillCatalog.errors as err (err.filePath + err.message)}
        <li><span class="skill-err-label">{err.label}</span> — {err.message}</li>
      {/each}
    </ul>
  </div>
{/if}

<p class="hint">
  Turn skills off, move them between menus, or reorder them — per
  machine. Changes apply to the menu bar, command palette, and slash
  commands immediately.
</p>

{#each SKILL_MENU_ORDER as menu (menu)}
  {@const items = skillsForMenu(menu)}
  <div class="field">
    <span class="field-label">{menu}</span>
    {#if items.length === 0}
      <p class="hint empty">No skills in this menu.</p>
    {:else}
      <ul class="skill-list">
        {#each items as s, i (s.id)}
          <li class:disabled={!skillEnabled(s)}>
            <div class="skill-row">
              <input
                type="checkbox"
                class="skill-toggle"
                checked={skillEnabled(s)}
                title={skillEnabled(s) ? 'Enabled — click to hide' : 'Hidden — click to enable'}
                onchange={() => toggleSkillEnabled(s)}
              />
              <span class="skill-name">{s.name}</span>
              <span class="skill-src" class:user={s.source === 'user'}>{s.source}</span>
              <div class="skill-controls">
                <button
                  class="reorder-btn"
                  title="Move up"
                  disabled={i === 0}
                  onclick={() => moveSkill(s, menu, -1)}
                >↑</button>
                <button
                  class="reorder-btn"
                  title="Move down"
                  disabled={i === items.length - 1}
                  onclick={() => moveSkill(s, menu, 1)}
                >↓</button>
                <select
                  class="skill-menu-select"
                  title="Move to menu"
                  value={menu}
                  onchange={(e) => reassignSkill(s, e.currentTarget.value as SkillMenu)}
                >
                  {#each SKILL_MENU_ORDER as m (m)}
                    <option value={m}>{m}</option>
                  {/each}
                </select>
                <select
                  class="skill-model-select"
                  title="Model for this skill — empty uses the skill's preferred model, then the default model"
                  value={toolModelOverrides[s.id] ?? ''}
                  onchange={(e) => setToolOverride(s.id, e.currentTarget.value)}
                >
                  <option value="">{defaultOptionLabel(s.model)}</option>
                  {#each MODEL_OPTIONS as m (m.value)}
                    <option value={m.value}>{m.label}</option>
                  {/each}
                </select>
                {#if s.source === 'user'}
                  <button class="link-btn" onclick={() => { void removeSkill(s.id); }} disabled={skillsBusy}>
                    Remove
                  </button>
                {/if}
              </div>
            </div>
            <span class="skill-desc">{s.description}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/each}

<style>
  /* Shared form vocabulary, scoped to this panel (app's per-dialog convention). */
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text);
    font-size: 12px;
  }
  .field-label { color: var(--text); }
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
  .field input[type="checkbox"] { cursor: pointer; }
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

  /* Skills panel (#629). */
  .skill-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .skill-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .skill-list li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    background: var(--bg-button);
    border-radius: 4px;
  }
  .skill-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .skill-list li.disabled .skill-name,
  .skill-list li.disabled .skill-desc {
    opacity: 0.45;
  }
  .skill-toggle {
    flex: none;
    margin: 0;
    cursor: pointer;
  }
  .skill-controls {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .reorder-btn {
    flex: none;
    width: 22px;
    height: 22px;
    padding: 0;
    line-height: 1;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    cursor: pointer;
  }
  .reorder-btn:hover:not(:disabled) { border-color: var(--accent); }
  .reorder-btn:disabled { opacity: 0.35; cursor: default; }
  .skill-menu-select,
  .skill-model-select {
    font-size: 12px;
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
  }
  .skill-model-select {
    /* Fixed width so every row's picker is the same length and the longest
       label ("Default · Claude Sonnet 4.6") fits without clipping. */
    flex: none;
    width: 210px;
  }
  .skill-name {
    font-weight: 600;
    font-size: 13px;
  }
  .skill-src {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted, var(--text));
    opacity: 0.6;
  }
  .skill-src.user {
    color: var(--accent);
    opacity: 1;
  }
  .skill-desc {
    font-size: 12px;
    color: var(--text-muted, var(--text));
    opacity: 0.8;
  }
  .skill-errs {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    font-size: 12px;
  }
  .skill-errs li {
    padding: 4px 0;
    color: var(--text);
  }
  .skill-err-label {
    font-weight: 600;
  }
</style>
