<script lang="ts">
  import type { CursorInfo } from './Editor.svelte';
  import Icon from './Icon.svelte';
  import { THEME_MODES, type ThemeMode } from '../theme';
  import { installDismissOnClickOutside } from '../dismiss-menu';

  interface Props {
    cursor: CursorInfo;
    fontSize: number;
    /** Current theme mode — drives both the status-bar label and the
     *  checked item in the picker. */
    theme: ThemeMode;
    inspectionCount?: number;
    /** Number of incoming wiki-links to the active note (#472). 0
     *  hides the item entirely — keeps the bar tidy for unlinked
     *  notes; we'll revisit if anyone wants the affirmative signal. */
    backlinkCount?: number;
    /** Whether the active note has unsaved changes. Drives the
     *  saved-state cue on the left (§7.3). When unset the cue is
     *  hidden (e.g. on a query tab with no save concept). */
    isDirty?: boolean;
    /** True when an active note tab exists. Lets us hide the saved
     *  cue entirely when no editable file is open. */
    hasActiveNote?: boolean;
    onGotoLine: () => void;
    /** Pick a theme directly (#1139) — replaces the old blind cycle on click. */
    onSelectTheme: (mode: ThemeMode) => void;
    onShowInspections?: () => void;
    /** Click handler for the backlink-count item — App reveals + focuses
     *  the right-sidebar Backlinks panel. */
    onShowBacklinks?: () => void;
    /** Semantic-index backfill progress (#836); null hides the indicator. */
    backfill?: { done: number; total: number } | null;
    /** Toggle voice dictation into the editor — same action as the right-click
     *  "Dictate" and ⌘⇧V. */
    onToggleDictation: () => void;
    /** True while dictation is capturing for the editor; highlights the mic. */
    dictationActive?: boolean;
    /** True when the pane shows preview only (no editor to dictate into) — the
     *  mic greys out. */
    dictationDisabled?: boolean;
  }

  let {
    cursor, fontSize, theme,
    inspectionCount = 0, backlinkCount = 0,
    isDirty = false, hasActiveNote = false,
    onGotoLine, onSelectTheme, onShowInspections, onShowBacklinks,
    backfill = null,
    onToggleDictation, dictationActive = false, dictationDisabled = false,
  }: Props = $props();

  let themeMenuOpen = $state(false);
  let themeMenuEl = $state<HTMLDivElement>();

  function toggleThemeMenu() {
    themeMenuOpen = !themeMenuOpen;
    if (themeMenuOpen) {
      installDismissOnClickOutside(() => { themeMenuOpen = false; }, '.theme-wrap');
    }
  }

  function pickTheme(mode: ThemeMode) {
    onSelectTheme(mode);
    themeMenuOpen = false;
  }

  // Focus the checked item when the picker opens so it's keyboard-drivable.
  $effect(() => {
    if (themeMenuOpen && themeMenuEl) {
      themeMenuEl.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    }
  });

  const themeLabels: Record<ThemeMode, string> =
    Object.fromEntries(THEME_MODES.map((m) => [m.value, m.label])) as Record<ThemeMode, string>;
</script>

<div class="status-bar">
  <div class="status-left">
    <button class="status-item nums clickable" onclick={onGotoLine} title="Go to Line (Cmd+G)">
      L{cursor.line} · C{cursor.column}
    </button>
    {#if cursor.selectionLength > 0}
      <span class="rule" aria-hidden="true"></span>
      <span class="status-item faint">{cursor.selectionLength} selected</span>
    {/if}
    {#if hasActiveNote}
      <span class="rule" aria-hidden="true"></span>
      <span class="status-item" class:faint={!isDirty}>
        {#if isDirty}
          <Icon name="dot" size={11} color="var(--accent)" />
          unsaved
        {:else}
          <Icon name="check" size={11} color="var(--sage)" />
          saved
        {/if}
      </span>
    {/if}
  </div>
  <div class="status-right">
    <button
      class="status-item clickable mic"
      class:active={dictationActive}
      onclick={onToggleDictation}
      disabled={dictationDisabled}
      aria-pressed={dictationActive}
      aria-label="Dictate"
      title={dictationDisabled
        ? 'Dictation isn’t available while previewing'
        : dictationActive ? 'Stop dictation (Cmd+Shift+V)' : 'Dictate — voice to text (Cmd+Shift+V)'}
    >
      <Icon name="mic" size={12} />
    </button>
    <span class="rule" aria-hidden="true"></span>
    {#if backfill}
      <span class="status-item faint" title="Building semantic search index in the background">
        <Icon name="sparkle" size={12} />
        <span class="nums">Embedding {backfill.done}/{backfill.total}…</span>
      </span>
      <span class="rule" aria-hidden="true"></span>
    {/if}
    {#if backlinkCount > 0}
      <button
        class="status-item clickable"
        onclick={onShowBacklinks}
        title="Show backlinks ({backlinkCount} note{backlinkCount === 1 ? '' : 's'} link here)"
      >
        <Icon name="backlinks" size={12} />
        <span class="nums">{backlinkCount}</span>
      </button>
    {/if}
    {#if inspectionCount > 0}
      <button class="status-item clickable inspection-count" onclick={onShowInspections} title="Show inspections">
        <Icon name="warn" size={12} />
        <span class="nums">{inspectionCount}</span>
      </button>
    {/if}
    <span class="rule" aria-hidden="true"></span>
    <span class="status-item faint nums">{cursor.wordCount} words</span>
    <span class="status-item faint">·</span>
    <span class="status-item faint nums">{fontSize}px</span>
    <span class="status-item faint">·</span>
    <div class="theme-wrap">
      <button
        class="status-item faint clickable"
        onclick={toggleThemeMenu}
        title="Theme — click to pick (Cmd+Shift+T cycles)"
        aria-haspopup="menu"
        aria-expanded={themeMenuOpen}
      >{themeLabels[theme]}</button>
      {#if themeMenuOpen}
        <div
          class="theme-menu"
          role="menu"
          tabindex="-1"
          bind:this={themeMenuEl}
          onkeydown={(e) => { if (e.key === 'Escape') { themeMenuOpen = false; } }}
        >
          {#each THEME_MODES as mode (mode.value)}
            <button
              role="menuitemradio"
              aria-checked={theme === mode.value}
              class="theme-menu-item"
              onclick={() => pickTheme(mode.value)}
            >
              <span class="check">{#if theme === mode.value}<Icon name="check" size={11} color="var(--accent)" />{/if}</span>
              {mode.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <span class="status-item faint">·</span>
    <span class="status-item faint">Markdown</span>
  </div>
</div>

<style>
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 12px;
    height: 28px;
    background: var(--bg-toolbar);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    font-family: var(--font-sans);
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .status-left,
  .status-right {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .status-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .status-item.faint {
    color: var(--text-faint);
  }

  .status-item.clickable {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }
  .status-item.clickable:hover {
    color: var(--text);
  }

  /* Dictation mic (#voice): accent while capturing, greyed + inert while the
     pane is showing preview (nothing to dictate into). */
  .status-item.clickable.mic.active,
  .status-item.clickable.mic.active:hover {
    color: var(--accent);
  }
  .status-item.clickable.mic:disabled {
    color: var(--text-faint);
    cursor: default;
    opacity: 0.5;
  }
  .status-item.clickable.mic:disabled:hover {
    color: var(--text-faint);
  }

  /* Mono cells get tabular-nums so digit columns line up — L47 · C23,
     word counts, font sizes. */
  .nums {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* 1px hairline rule between item groups (§7.3). */
  .rule {
    display: inline-block;
    width: 1px;
    height: 11px;
    background: var(--border);
    flex-shrink: 0;
  }

  /* Theme picker — a small popup that opens upward from the status bar. */
  .theme-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .theme-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    z-index: 1000;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 140px;
    display: flex;
    flex-direction: column;
  }
  .theme-menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px 6px 8px;
    border: none;
    background: none;
    color: var(--text);
    font-family: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .theme-menu-item:hover,
  .theme-menu-item:focus-visible {
    background: var(--bg-button);
    outline: none;
  }
  .theme-menu-item .check {
    display: inline-flex;
    width: 12px;
    flex-shrink: 0;
  }

  /* Inspections badge uses --rust (no hardcoded peach). */
  .inspection-count {
    color: var(--rust);
  }
  .inspection-count:hover {
    color: var(--rust);
    opacity: 0.85;
  }
</style>
