<script lang="ts">
  /**
   * Frontmatter property editor (#471). Surfaces the active note's
   * YAML frontmatter as a structured key/value list with type-aware
   * editors. Edits round-trip through the YAML parser so comments
   * and key order survive.
   *
   * Source-of-truth flow:
   *   editor buffer  ──parsed──>  rows ──UI edits──>  rewritten YAML
   *                                                       │
   *                                                       └─> onContentChange
   *
   * The reactive `$derived` re-runs whenever `content` changes (the
   * editor reflowing into us, or our own write coming back), so no
   * separate sync state is needed.
   */

  import YAML from 'yaml';
  import { onMount, tick } from 'svelte';
  import { api } from '../../ipc/client';
  import { getNotebaseStore } from '../../stores/notebase.svelte';
  import AutocompleteDropdown from './AutocompleteDropdown.svelte';
  import Icon from '../Icon.svelte';
  import { resolveWikiLinkTarget } from '../../wiki-link-resolver';
  import type { IconName } from '../icons/registry';
  import { CANONICAL_FRONTMATTER_KEYS } from '../../../../shared/frontmatter-canonical-keys';
  import PropertyValueEditor from '../PropertyValueEditor.svelte';
  import {
    SCALAR_TYPES,
    isScalarType,
    coerceScalar,
    scalarToText,
    type ScalarType,
  } from '../../../../shared/refactor/property-shape';
  import {
    parseFrontmatter,
    keyToString,
    applyFrontmatterMutation,
    type Row,
  } from '../../../../shared/refactor/frontmatter-rows';

  /** Type-icon mapping per §13.1. The icon signals the value shape at
   *  a glance so a row reads as "number" or "list" without parsing
   *  the value-control widget. */
  const TYPE_ICON: Record<string, IconName> = {
    string: 'outline',
    number: 'tables',
    boolean: 'check',
    date: 'bookmark',
    'string-list': 'tags',
    'wiki-link': 'link',
    yaml: 'query',
  };
  function typeIcon(kind: string): IconName {
    return TYPE_ICON[kind] ?? 'outline';
  }

  /** Canonical keys' icons render in accent; custom keys in text-faint. */
  const CANONICAL_KEY_SET: ReadonlySet<string> = new Set(CANONICAL_FRONTMATTER_KEYS);
  function isCanonical(key: string): boolean {
    return CANONICAL_KEY_SET.has(key);
  }

  interface Props {
    content: string;
    onContentChange: (next: string) => void;
    /** Wired by RightSidebar so a wiki-link chip can open the target
     *  note via the same short-form resolver the editor uses for
     *  `[[…]]` clicks (handles basenames, aliases, slug-fuzzy matches).
     *  Optional — when absent the chip renders disabled. */
    onNavigate?: (target: string) => void | Promise<void>;
  }

  let { content, onContentChange, onNavigate }: Props = $props();

  const notebase = getNotebaseStore();


  const parsed = $derived(parseFrontmatter(content));

  const rows = $derived(parsed.ok ? parsed.rows : []);
  const hasError = $derived(!parsed.ok);
  const errorMessage = $derived(parsed.ok ? '' : parsed.error);
  const hasFrontmatter = $derived(parsed.ok && !('none' in parsed));

  // Editing a value too eagerly fights the user mid-keystroke. Mirror
  // each row into a local `draft` keyed by row index; flush to the
  // buffer on blur or after a short idle window.
  let drafts = $state<Record<string, string>>({});
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Apply a mutation to the frontmatter and flush the result back to the editor
   * buffer. The parse → mutate → reserialize → splice engine lives in
   * frontmatter-rows.ts (#1596); a null result means "unparseable — don't
   * clobber the user's WIP", so we no-op.
   */
  function mutate(fn: (doc: YAML.Document) => void): void {
    const next = applyFrontmatterMutation(content, fn);
    if (next !== null) onContentChange(next);
  }

  function setKeyValue(key: string, value: unknown): void {
    mutate((doc) => {
      if (!YAML.isMap(doc.contents)) return;
      doc.set(key, value);
    });
  }

  function setKeyValueList(key: string, values: string[]): void {
    mutate((doc) => {
      if (!YAML.isMap(doc.contents)) return;
      const seq = new YAML.YAMLSeq();
      for (const v of values) seq.add(v);
      doc.set(key, seq);
    });
  }

  function removeKey(key: string): void {
    mutate((doc) => {
      if (!YAML.isMap(doc.contents)) return;
      doc.delete(key);
    });
  }

  function renameKey(oldKey: string, newKey: string): void {
    if (oldKey === newKey || !newKey) return;
    mutate((doc) => {
      if (!YAML.isMap(doc.contents)) return;
      const items = doc.contents.items;
      for (const pair of items) {
        if (keyToString(pair.key) === oldKey && YAML.isScalar(pair.key)) {
          pair.key.value = newKey;
        }
      }
    });
  }

  // ── Type-specific commit helpers ──────────────────────────────

  function commitString(key: string, raw: string): void {
    setKeyValue(key, raw);
  }

  function commitNumber(key: string, raw: string): void {
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setKeyValue(key, n);
  }

  function commitBoolean(key: string, value: boolean): void {
    setKeyValue(key, value);
  }

  function commitDate(key: string, value: string): void {
    setKeyValue(key, value);
  }

  // ── Scalar editor glue (shared PropertyValueEditor) ───────────────
  // The four scalar widgets are rendered by PropertyValueEditor; the panel
  // keeps owning debounce (text/number) and immediate commit (boolean/date),
  // so typing behaviour is unchanged from the inline version.

  function scalarText(row: Row): string {
    const s = row.shape;
    if (s.kind === 'string') return drafts[row.key] ?? s.value;
    if (s.kind === 'number') return drafts[row.key] ?? String(s.value);
    if (s.kind === 'date') return s.value;
    return '';
  }
  function onScalarInput(row: Row, raw: string): void {
    if (row.shape.kind === 'string') scheduleFlush(row.key, raw, commitString);
    else if (row.shape.kind === 'number') scheduleFlush(row.key, raw, commitNumber);
  }
  function onScalarCommit(row: Row, raw: string): void {
    if (row.shape.kind === 'string') commitString(row.key, raw);
    else if (row.shape.kind === 'number') commitNumber(row.key, raw);
    else if (row.shape.kind === 'date') commitDate(row.key, raw);
  }

  // ── Type switcher ─────────────────────────────────────────────────
  // The type icon on a scalar row is a button: it opens a small menu that
  // re-types the value. The current value is stringified and re-coerced to
  // the chosen type (e.g. string "false" → boolean false), then committed.

  let typeMenuKey = $state<string | null>(null);
  function toggleTypeMenu(key: string): void {
    typeMenuKey = typeMenuKey === key ? null : key;
  }
  function changeType(row: Row, next: ScalarType): void {
    typeMenuKey = null;
    if (row.shape.kind === next) return;
    const current = 'value' in row.shape ? scalarToText(row.shape.value) : '';
    setKeyValue(row.key, coerceScalar(next, current));
  }

  function scheduleFlush(key: string, value: string, fn: (k: string, v: string) => void): void {
    drafts[key] = value;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      const v = drafts[key];
      if (v !== undefined) fn(key, v);
      flushTimer = null;
    }, 250);
  }

  // ── String-list (chip) editing ────────────────────────────────

  let newChip = $state<Record<string, string>>({});
  function addChip(key: string, current: string[]): void {
    const v = (newChip[key] ?? '').trim();
    if (!v) return;
    setKeyValueList(key, [...current, v]);
    newChip[key] = '';
  }
  function removeChip(key: string, current: string[], idx: number): void {
    const next = current.slice();
    next.splice(idx, 1);
    setKeyValueList(key, next);
  }

  // ── Adding a new property ──────────────────────────────────────

  let newKey = $state('');

  // Project-wide frontmatter keys + canonical-key backfill, for the
  // Add-Property autocomplete (#488). Fetched once on mount and
  // refreshed when the file watcher reports any rewrite — so a
  // freshly-added key (via `set_properties`, auto-tag, or a direct
  // edit) shows up the next time the user opens the picker without
  // a manual reload.
  let projectKeys = $state<string[]>([]);
  async function refreshProjectKeys(): Promise<void> {
    try { projectKeys = await api.graph.frontmatterKeys(); }
    catch { /* graph not ready yet — leave previous snapshot in place */ }
  }
  // Note basenames (relativePath without `.md`), for the wiki-link
  // value picker (#489). Same refresh cadence as projectKeys.
  let noteBasenames = $state<string[]>([]);
  /** Flat note file list, retained to feed `resolveWikiLinkTarget` so
   *  the wiki-chip can colour itself when its target is broken. */
  let flatNotes = $state<{ relativePath: string; isDirectory: boolean }[]>([]);
  let aliasMap = $state<Record<string, string>>({});

  async function refreshNoteBasenames(): Promise<void> {
    try {
      const files = await api.notebase.listFiles();
      const out: string[] = [];
      const flat: { relativePath: string; isDirectory: boolean }[] = [];
      const walk = (nodes: import('../../../../shared/types').NoteFile[]) => {
        for (const n of nodes) {
          if (n.isDirectory && n.children) walk(n.children);
          else if (!n.isDirectory && n.relativePath.endsWith('.md')) {
            out.push(n.relativePath.replace(/\.md$/, ''));
            flat.push({ relativePath: n.relativePath, isDirectory: false });
          }
        }
      };
      walk(files);
      out.sort((a, b) => a.localeCompare(b));
      noteBasenames = out;
      flatNotes = flat;
    } catch { /* tree not ready yet */ }
    try {
      aliasMap = await api.graph.aliasMap();
    } catch { /* not ready */ }
  }

  function wikiLinkResolves(target: string): boolean {
    if (!target) return false;
    return resolveWikiLinkTarget(target, flatNotes, aliasMap) !== null;
  }
  onMount(() => {
    void refreshProjectKeys();
    void refreshNoteBasenames();
    const unsubscribeRewritten = notebase.onRewritten(() => {
      void refreshProjectKeys();
    });
    const unsubscribeCreated = notebase.onFileCreated(() => {
      void refreshNoteBasenames();
    });
    const unsubscribeDeleted = notebase.onFileDeleted(() => {
      void refreshNoteBasenames();
    });
    return () => {
      // subscribeIpc returns an unsubscribe — guarded because the
      // preload bridge's type uses `void`-ish callbacks.
      unsubscribeRewritten?.();
      unsubscribeCreated?.();
      unsubscribeDeleted?.();
    };
  });

  /** Merged autocomplete pool for the Add-Property input:
   *   1. Project keys (highest priority — what the user has been
   *      using on other notes).
   *   2. Canonical keys (well-known predicates worth suggesting even
   *      if no note has used them yet).
   *  Already-present keys on this note are filtered out so the
   *  dropdown doesn't tempt the user to "re-add" something. */
  const addPropertyOptions = $derived.by(() => {
    const present = new Set(rows.map((r) => r.key));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of projectKeys) {
      if (present.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    for (const k of CANONICAL_FRONTMATTER_KEYS) {
      if (present.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  });

  async function addProperty(commitKey?: string): Promise<void> {
    const k = (commitKey ?? newKey).trim();
    if (!k) return;
    if (rows.some((r) => r.key === k)) {
      // Already exists — just focus its input. Keep newKey so the
      // user can see what they typed.
      return;
    }
    setKeyValue(k, '');
    newKey = '';
    await tick();
    // Focus the freshly-rendered string input so the user can type
    // the value without an extra click.
    const el = document.querySelector<HTMLElement>(
      `.properties-panel [data-row-key="${cssAttr(k)}"] input`,
    );
    el?.focus();
  }
  function cssAttr(s: string): string {
    return s.replace(/[\\"]/g, '\\$&');
  }

  // ── Wiki-link value editing (#489) ──────────────────────────────
  //
  // When a row's value is a single `[[target]]` (optionally with a
  // display alias), the panel renders a clickable chip. Clicking the
  // chip opens the target via the standard onFileSelect plumbing;
  // the ✎ button swaps the chip for an inline AutocompleteDropdown
  // sourced from project note basenames. Editing keys are kept by
  // row key so two wiki-link rows can be edited independently (rare
  // but possible).
  let editingLinkKey = $state<string | null>(null);
  let editingLinkDraft = $state('');
  let editingLinkDisplay = $state<string | null>(null);
  function startEditLink(rowKey: string, target: string, display: string | null): void {
    editingLinkKey = rowKey;
    editingLinkDraft = target;
    editingLinkDisplay = display;
  }
  function commitEditLink(value: string): void {
    if (!editingLinkKey) return;
    const target = value.trim();
    if (!target) {
      cancelEditLink();
      return;
    }
    const raw = editingLinkDisplay
      ? `[[${target}|${editingLinkDisplay}]]`
      : `[[${target}]]`;
    setKeyValue(editingLinkKey, raw);
    editingLinkKey = null;
    editingLinkDraft = '';
    editingLinkDisplay = null;
  }
  function cancelEditLink(): void {
    editingLinkKey = null;
    editingLinkDraft = '';
    editingLinkDisplay = null;
  }
  function openWikiLink(target: string): void {
    if (!onNavigate) return;
    void onNavigate(target);
  }

  function createEmptyFrontmatter(): void {
    // Best-effort focus on the autocomplete input rendered below.
    // Querying by class is fragile; the autofocus prop on the
    // dropdown handles the common path.
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(
        '.properties-panel .empty .ac-input',
      )?.focus();
    });
  }
</script>

<div class="properties-panel">
  {#if hasError}
    <div class="error" role="alert">
      <strong>Frontmatter has a YAML error</strong>
      <div class="message">{errorMessage}</div>
      <div class="hint">Editing is disabled until the YAML parses. Fix it in the editor.</div>
    </div>
  {:else if !hasFrontmatter && rows.length === 0}
    <div class="empty">
      <p>No frontmatter</p>
      <AutocompleteDropdown
        value={newKey}
        options={addPropertyOptions}
        placeholder="Add property…"
        autofocus={false}
        onInput={(v) => { newKey = v; }}
        onCommit={(v) => { newKey = v; void addProperty(v); }}
      />
      <button class="add-btn" onclick={createEmptyFrontmatter}>+ Add property</button>
    </div>
  {:else}
    <div class="rows">
      {#each rows as row (row.key)}
        {@const canonical = isCanonical(row.key)}
        <div class="row" class:canonical data-row-key={row.key}>
          {#if isScalarType(row.shape.kind)}
            <div class="type-switch">
              <button
                class="type-icon type-icon-btn"
                title="Change type ({row.shape.kind})"
                aria-haspopup="menu"
                aria-expanded={typeMenuKey === row.key}
                onclick={() => toggleTypeMenu(row.key)}
              >
                <Icon
                  name={typeIcon(row.shape.kind)}
                  size={12}
                  color={canonical ? 'var(--accent)' : 'var(--text-faint)'}
                />
              </button>
              {#if typeMenuKey === row.key}
                <button class="type-menu-backdrop" aria-label="Close type menu" onclick={() => (typeMenuKey = null)}></button>
                <div class="type-menu" role="menu">
                  {#each SCALAR_TYPES as t}
                    <button
                      class="type-menu-item"
                      class:selected={t === row.shape.kind}
                      role="menuitemradio"
                      aria-checked={t === row.shape.kind}
                      onclick={() => changeType(row, t)}
                    >
                      <Icon name={typeIcon(t)} size={11} />
                      <span>{t}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <span class="type-icon" title={row.shape.kind}>
              <Icon
                name={typeIcon(row.shape.kind)}
                size={12}
                color={canonical ? 'var(--accent)' : 'var(--text-faint)'}
              />
            </span>
          {/if}
          <input
            class="key"
            type="text"
            value={row.key}
            onchange={(e) => renameKey(row.key, e.currentTarget.value.trim())}
            spellcheck="false"
          />
          <div class="value">
            {#if isScalarType(row.shape.kind)}
              <PropertyValueEditor
                type={row.shape.kind}
                text={scalarText(row)}
                checked={row.shape.kind === 'boolean' ? row.shape.value : false}
                onInput={(raw) => onScalarInput(row, raw)}
                onCommit={(raw) => onScalarCommit(row, raw)}
                onToggle={(c) => commitBoolean(row.key, c)}
              />
            {:else if row.shape.kind === 'string-list'}
              <div class="chips">
                {#each row.shape.value as chip, i (chip + ':' + i)}
                  <span class="chip">
                    {chip}
                    <button
                      class="chip-x"
                      title="Remove"
                      aria-label="Remove {chip}"
                      onclick={() => removeChip(row.key, (row.shape as { kind: 'string-list'; value: string[] }).value, i)}
                    >×</button>
                  </span>
                {/each}
                <input
                  type="text"
                  class="chip-input"
                  placeholder="Add…"
                  value={newChip[row.key] ?? ''}
                  oninput={(e) => { newChip[row.key] = e.currentTarget.value; }}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addChip(row.key, (row.shape as { kind: 'string-list'; value: string[] }).value);
                    }
                  }}
                />
              </div>
            {:else if row.shape.kind === 'wiki-link'}
              {#if editingLinkKey === row.key}
                <AutocompleteDropdown
                  value={editingLinkDraft}
                  options={noteBasenames}
                  placeholder="Note name…"
                  autofocus
                  onInput={(v) => { editingLinkDraft = v; }}
                  onCommit={commitEditLink}
                  onCancel={cancelEditLink}
                />
              {:else}
                {@const ws = row.shape}
                {@const resolves = wikiLinkResolves(ws.target)}
                <div class="wiki-chip-row">
                  <button
                    type="button"
                    class="wiki-chip"
                    class:broken={!resolves}
                    title={resolves ? `Open ${ws.target}` : `No note matches "${ws.target}"`}
                    onclick={() => openWikiLink(ws.target)}
                    disabled={!onNavigate}
                  >
                    {#if resolves}
                      <span class="wiki-chip-icon"><Icon name="link" size={11} /></span>
                    {:else}
                      <span class="wiki-chip-icon"><Icon name="warn" size={11} color="var(--rust)" /></span>
                    {/if}
                    <span class="wiki-chip-label">{ws.display ?? ws.target}</span>
                  </button>
                  <button
                    type="button"
                    class="wiki-edit-btn"
                    title="Edit link target"
                    aria-label="Edit link target"
                    onclick={() => startEditLink(row.key, ws.target, ws.display)}
                  >✎</button>
                </div>
              {/if}
            {:else if row.shape.kind === 'yaml'}
              <pre class="yaml">{row.shape.raw}</pre>
              <span class="hint-inline">Edit in source — structured editor doesn't cover this shape.</span>
            {/if}
          </div>
          <button class="row-x" title="Remove property" aria-label="Remove {row.key}" onclick={() => removeKey(row.key)}>
            <Icon name="close" size={10} />
          </button>
        </div>
      {/each}
    </div>

    {#if hasFrontmatter || rows.length > 0}
      {@const presentKeys = new Set(rows.map((r) => r.key))}
      {@const canonicalSuggestions = CANONICAL_FRONTMATTER_KEYS.filter((k) => !presentKeys.has(k)).slice(0, 5)}
      <div class="add-row">
        <span class="add-icon"><Icon name="plus" size={12} color="var(--text-faint)" /></span>
        <AutocompleteDropdown
          value={newKey}
          options={addPropertyOptions}
          placeholder="Add property…"
          onInput={(v) => { newKey = v; }}
          onCommit={(v) => { newKey = v; void addProperty(v); }}
        />
        <button class="add-btn" onclick={() => void addProperty()} disabled={!newKey.trim()}>
          <Icon name="plus" size={12} />
        </button>
      </div>
      {#if canonicalSuggestions.length > 0}
        <div class="suggestions" aria-label="Canonical key suggestions">
          {#each canonicalSuggestions as k (k)}
            <button class="suggest-chip" onclick={() => void addProperty(k)} title="Add canonical key {k}">
              + {k}
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .properties-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .rows {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
  }

  /* Row layout (§13.1) — [type-icon, key, value, ×]. Type icon column
     is 12px + a 6px gap; canonical keys get the accent rail on hover. */
  .row {
    display: grid;
    grid-template-columns: 14px 90px 1fr 18px;
    gap: 8px;
    align-items: center;
    padding: 5px 12px;
    border-left: 2px solid transparent;
    font-size: 12px;
  }
  .row:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    border-left-color: color-mix(in oklch, var(--accent) 60%, transparent);
  }
  .row.canonical:hover {
    border-left-color: var(--accent);
  }
  .type-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .type-switch {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }
  .type-icon-btn {
    padding: 2px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    cursor: pointer;
    line-height: 0;
  }
  .type-icon-btn:hover {
    border-color: var(--border-strong);
    background: var(--bg-inset);
  }
  .type-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: none;
    border: none;
    cursor: default;
  }
  .type-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 41;
    display: flex;
    flex-direction: column;
    min-width: 116px;
    padding: 4px;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }
  .type-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }
  .type-menu-item:hover {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    color: var(--text);
  }
  .type-menu-item.selected {
    color: var(--accent);
  }

  .row .key {
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row.canonical .key {
    color: var(--text);
  }
  .row .key:hover,
  .row .key:focus {
    background: var(--bg-inset);
    color: var(--text);
    outline: none;
  }

  .row .value {
    min-width: 0;
  }
  /* The value inputs render inside <PropertyValueEditor>, so their styling lives
     there — scoped `.row .value > input` rules here never matched (#1600). */

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 2px 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-button);
    color: var(--text);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 11px;
  }
  .chip-x {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 0;
  }
  .chip-x:hover { color: var(--text); }
  .chip-input {
    flex: 1;
    min-width: 60px;
    background: none;
    border: 1px dashed var(--border);
    border-radius: 10px;
    padding: 1px 6px;
    color: var(--text);
    font-size: 11px;
  }
  .chip-input:focus {
    border-style: solid;
    border-color: var(--accent);
    outline: none;
  }

  /* Wiki-link value chip + adjacent edit button (#489). Mirrors the
     existing string-list chip styling so the panel reads as one
     consistent surface — chip is the open-target affordance, ✎ swaps
     to the autocomplete edit input. */
  .wiki-chip-row {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
  }
  .wiki-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-button);
    border: 1px solid transparent;
    color: var(--accent);
    padding: 1px 8px 1px 6px;
    border-radius: 10px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wiki-chip:hover:not(:disabled) {
    border-color: var(--accent);
    text-decoration-color: var(--accent);
  }
  .wiki-chip:disabled {
    cursor: default;
    color: var(--text-muted);
    text-decoration: none;
  }
  /* Broken wiki-link target — no matching note resolved. Rust tone
     matches the right-sidebar Outgoing panel's dead-link treatment
     (#548 §13.1). */
  .wiki-chip.broken {
    color: var(--rust);
    text-decoration-color: color-mix(in srgb, var(--rust) 40%, transparent);
  }
  .wiki-chip.broken:hover:not(:disabled) {
    border-color: var(--rust);
    text-decoration-color: var(--rust);
  }
  .wiki-chip-icon { font-size: 10px; opacity: 0.7; }
  .wiki-chip-label { overflow: hidden; text-overflow: ellipsis; }
  .wiki-edit-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .wiki-edit-btn:hover {
    color: var(--text);
    background: var(--bg-button);
  }

  .yaml {
    margin: 0;
    padding: 4px 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .hint-inline {
    display: block;
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .row-x {
    background: none;
    border: none;
    color: var(--text-faint);
    cursor: pointer;
    padding: 0;
    visibility: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .row:hover .row-x { visibility: visible; }
  .row-x:hover { color: var(--text); }

  .add-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .add-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    flex-shrink: 0;
  }
  .add-btn {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 3px 8px;
    border-radius: 5px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .add-btn:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .add-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Canonical-key suggestions (§13.1) — dashed pill chips below the
     add-row that quick-add a canonical key without the user having
     to remember its name. */
  .suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    padding: 0 12px 10px;
    flex-shrink: 0;
  }
  .suggest-chip {
    padding: 2px 8px;
    border: 1px dashed color-mix(in oklch, var(--accent) 40%, transparent);
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    cursor: pointer;
  }
  .suggest-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in oklch, var(--accent) 10%, transparent);
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .empty p {
    margin: 0;
  }

  .error {
    margin: 12px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
  }
  .error strong {
    display: block;
    color: var(--text);
    margin-bottom: 2px;
  }
  .error .message {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
    margin-bottom: 4px;
  }
  .error .hint {
    color: var(--text-muted);
    font-size: 11px;
  }
</style>
