<script lang="ts">
  /**
   * Generic input + dropdown autocomplete used by the Properties
   * panel for two roles:
   *
   *  - Add-Property key picker (#488) — source is project keys
   *    union canonical keys minus what's already on the active note.
   *  - Wiki-link value editor (#489) — source is the project's note
   *    basenames (relativePath minus `.md`).
   *
   * Ranking is exact > prefix > substring, case-insensitive. Empty
   * input shows the first 12 options unchanged so the user can browse
   * without typing first.
   *
   * Keyboard model mirrors the editor's CodeMirror autocomplete:
   *  - ↑/↓: move highlight (wraps).
   *  - Enter: commit the highlighted suggestion (or the raw text if no
   *    suggestion is highlighted AND `allowFreeText` is set).
   *  - Tab: same as Enter.
   *  - Esc: closes the popover; second Esc bubbles a cancel.
   */
  import { onMount, tick } from 'svelte';

  interface Props {
    value: string;
    options: readonly string[];
    placeholder?: string;
    /** When true, Enter commits the raw input text even if it doesn't
     *  appear in `options`. Default true — both call-sites want this
     *  (new property keys and new wiki-link targets are valid). */
    allowFreeText?: boolean;
    /** Max rows in the popover. Default 8. */
    maxRows?: number;
    /** Optional extra class for the wrapper (lets the call-site shape
     *  its own input chrome without forking the component). */
    class?: string;
    /** Whether to autofocus the input on mount. Default false. */
    autofocus?: boolean;
    onInput: (next: string) => void;
    onCommit: (value: string) => void;
    onCancel?: () => void;
  }

  let {
    value,
    options,
    placeholder = '',
    allowFreeText = true,
    maxRows = 8,
    class: className = '',
    autofocus = false,
    onInput,
    onCommit,
    onCancel,
  }: Props = $props();

  let inputEl = $state<HTMLInputElement | undefined>();
  let open = $state(false);
  let highlightIndex = $state(0);

  onMount(() => {
    if (autofocus && inputEl) inputEl.focus();
  });

  /** Rank options against the current input. Exact (after lowercasing)
   *  beats prefix beats substring; ties fall back to lexicographic. */
  const matches = $derived.by(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice(0, maxRows);
    const exact: string[] = [];
    const prefix: string[] = [];
    const substring: string[] = [];
    for (const opt of options) {
      const lo = opt.toLowerCase();
      if (lo === q) exact.push(opt);
      else if (lo.startsWith(q)) prefix.push(opt);
      else if (lo.includes(q)) substring.push(opt);
    }
    return [...exact, ...prefix, ...substring].slice(0, maxRows);
  });

  // Reset highlight to top whenever the match set changes — keeping a
  // stale index past the new list's length would point at nothing.
  $effect(() => {
    void matches;
    highlightIndex = 0;
  });

  function commitHighlight(): void {
    const choice = matches[highlightIndex];
    if (choice !== undefined) {
      onCommit(choice);
      open = false;
      return;
    }
    if (allowFreeText && value.trim()) {
      onCommit(value.trim());
      open = false;
    }
  }

  async function handleKeydown(e: KeyboardEvent): Promise<void> {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (matches.length === 0) return;
      open = true;
      highlightIndex = (highlightIndex + 1) % matches.length;
      await scrollHighlightIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (matches.length === 0) return;
      open = true;
      highlightIndex = (highlightIndex - 1 + matches.length) % matches.length;
      await scrollHighlightIntoView();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      // Tab here behaves like Enter: commit. Avoid stealing tab away
      // from the user when the popover has no candidates AND no free
      // text is allowed (let focus advance naturally).
      if (matches.length === 0 && (!allowFreeText || !value.trim())) return;
      e.preventDefault();
      commitHighlight();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (open) {
        open = false;
      } else {
        onCancel?.();
      }
    }
  }

  async function scrollHighlightIntoView(): Promise<void> {
    await tick();
    const el = document.querySelector<HTMLElement>(
      '.autocomplete-dropdown .ac-option.active',
    );
    el?.scrollIntoView({ block: 'nearest' });
  }
</script>

<div class="autocomplete-dropdown {className}">
  <input
    bind:this={inputEl}
    type="text"
    class="ac-input"
    {value}
    {placeholder}
    spellcheck="false"
    autocomplete="off"
    oninput={(e) => { onInput(e.currentTarget.value); open = true; }}
    onfocus={() => { open = true; }}
    onblur={() => {
      // Defer close so an option click registers before the popover
      // disappears (mousedown on a child fires before blur).
      setTimeout(() => { open = false; }, 150);
    }}
    onkeydown={(e) => { void handleKeydown(e); }}
  />
  {#if open && matches.length > 0}
    <ul class="ac-list" role="listbox" style="--ac-max-rows: {maxRows};">
      {#each matches as opt, i (opt)}
        <li
          role="option"
          aria-selected={i === highlightIndex}
          class="ac-option"
          class:active={i === highlightIndex}
          onmousedown={(e) => {
            e.preventDefault();
            highlightIndex = i;
            commitHighlight();
          }}
          onmouseenter={() => { highlightIndex = i; }}
        >
          {opt}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .autocomplete-dropdown {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .ac-input {
    width: 100%;
    background: var(--bg-button);
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 3px 6px;
    color: var(--text);
    font-size: 12px;
    font-family: inherit;
    box-sizing: border-box;
  }
  .ac-input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .ac-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin: 2px 0 0;
    padding: 2px 0;
    list-style: none;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 100;
    max-height: calc(var(--ac-max-rows) * 22px + 4px);
    overflow-y: auto;
  }
  .ac-option {
    padding: 3px 8px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ac-option.active {
    background: var(--accent);
    color: var(--bg);
  }
</style>
