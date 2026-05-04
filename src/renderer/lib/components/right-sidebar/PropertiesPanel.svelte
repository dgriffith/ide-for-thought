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
  import { tick } from 'svelte';

  interface Props {
    content: string;
    onContentChange: (next: string) => void;
  }

  let { content, onContentChange }: Props = $props();

  type ValueShape =
    | { kind: 'string'; value: string }
    | { kind: 'number'; value: number }
    | { kind: 'boolean'; value: boolean }
    | { kind: 'date'; value: string }
    | { kind: 'string-list'; value: string[] }
    | { kind: 'yaml'; raw: string };

  interface Row {
    key: string;
    shape: ValueShape;
  }

  interface ParseResult {
    ok: true;
    rows: Row[];
    /** Raw frontmatter block (between `---` fences, exclusive). */
    body: string;
    /** Index in `content` where the frontmatter block begins (`---\n`). */
    blockStart: number;
    /** Index in `content` where the frontmatter block ends (after the closing `---\n`). */
    blockEnd: number;
  }

  interface ParseError {
    ok: false;
    error: string;
  }

  interface NoFrontmatter {
    ok: true;
    rows: [];
    body: '';
    blockStart: 0;
    blockEnd: 0;
    none: true;
  }

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

  function parseFrontmatter(text: string): ParseResult | ParseError | NoFrontmatter {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
    if (!m) {
      return { ok: true, rows: [], body: '', blockStart: 0, blockEnd: 0, none: true };
    }
    const body = m[1];
    const blockEnd = m[0].length;
    let doc: YAML.Document.Parsed;
    try {
      doc = YAML.parseDocument(body);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (doc.errors.length > 0) {
      return { ok: false, error: doc.errors[0].message };
    }
    if (!YAML.isMap(doc.contents)) {
      return { ok: false, error: 'Frontmatter is not a key/value map.' };
    }
    const out: Row[] = [];
    for (const pair of doc.contents.items) {
      const key = keyToString(pair.key);
      if (key === null) continue;
      const value = pair.value;
      out.push({ key, shape: detectShape(value) });
    }
    return { ok: true, rows: out, body, blockStart: 0, blockEnd };
  }

  function keyToString(k: unknown): string | null {
    if (YAML.isScalar(k)) return String(k.value);
    if (typeof k === 'string') return k;
    return null;
  }

  function detectShape(value: unknown): ValueShape {
    if (YAML.isScalar(value)) {
      const v = value.value;
      if (typeof v === 'boolean') return { kind: 'boolean', value: v };
      if (typeof v === 'number') return { kind: 'number', value: v };
      if (v instanceof Date) {
        return { kind: 'date', value: v.toISOString().slice(0, 10) };
      }
      if (typeof v === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { kind: 'date', value: v };
        return { kind: 'string', value: v };
      }
      // null, undefined, or an oddball scalar shape — treat as empty
      // string so the row is still editable. Bare `String(obj)` would
      // surface "[object Object]" so we go through JSON.
      if (v == null) return { kind: 'string', value: '' };
      return { kind: 'string', value: JSON.stringify(v) };
    }
    if (YAML.isSeq(value)) {
      const items = value.items;
      const stringValues: string[] = [];
      let allStrings = true;
      for (const it of items) {
        if (YAML.isScalar(it) && typeof it.value === 'string') {
          stringValues.push(it.value);
        } else {
          allStrings = false;
          break;
        }
      }
      if (allStrings) {
        return { kind: 'string-list', value: stringValues };
      }
      return { kind: 'yaml', raw: YAML.stringify(value).trimEnd() };
    }
    if (YAML.isMap(value)) {
      return { kind: 'yaml', raw: YAML.stringify(value).trimEnd() };
    }
    return { kind: 'yaml', raw: YAML.stringify(value).trimEnd() };
  }

  /**
   * Apply a mutation to the YAML document and flush back to the
   * editor buffer. Mutator runs inside a successfully-parsed doc;
   * if parsing fails we no-op rather than overwrite the user's WIP.
   */
  function mutate(fn: (doc: YAML.Document) => void): void {
    if (!parsed.ok) return;
    if ('none' in parsed) {
      // No frontmatter yet — caller is creating one. Build a fresh doc.
      const doc = new YAML.Document({});
      fn(doc);
      const yaml = doc.toString().trimEnd();
      const next = `---\n${yaml}\n---\n${content}`;
      onContentChange(next);
      return;
    }
    let doc: YAML.Document.Parsed;
    try {
      doc = YAML.parseDocument(parsed.body);
      if (doc.errors.length > 0) return;
    } catch {
      return;
    }
    fn(doc);
    let serialised = doc.toString();
    if (serialised.endsWith('\n')) serialised = serialised.slice(0, -1);
    // If the deletion left the map empty, drop the entire block —
    // an empty `---\n\n---` block reads as malformed YAML to readers.
    if (YAML.isMap(doc.contents) && doc.contents.items.length === 0) {
      onContentChange(content.slice(parsed.blockEnd));
      return;
    }
    const next = content.slice(0, parsed.blockStart) +
      `---\n${serialised}\n---\n` +
      content.slice(parsed.blockEnd);
    onContentChange(next);
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
  let newKeyInputEl = $state<HTMLInputElement | undefined>();
  async function addProperty(): Promise<void> {
    const k = newKey.trim();
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

  function createEmptyFrontmatter(): void {
    if (!newKeyInputEl) return;
    newKeyInputEl.focus();
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
      <input
        type="text"
        class="key-input"
        placeholder="Add property…"
        bind:value={newKey}
        bind:this={newKeyInputEl}
        onkeydown={(e) => { if (e.key === 'Enter') void addProperty(); }}
      />
      <button class="add-btn" onclick={createEmptyFrontmatter}>+ Add property</button>
    </div>
  {:else}
    <div class="rows">
      {#each rows as row (row.key)}
        <div class="row" data-row-key={row.key}>
          <input
            class="key"
            type="text"
            value={row.key}
            onchange={(e) => renameKey(row.key, e.currentTarget.value.trim())}
            spellcheck="false"
          />
          <div class="value">
            {#if row.shape.kind === 'string'}
              <input
                type="text"
                value={drafts[row.key] ?? row.shape.value}
                oninput={(e) => scheduleFlush(row.key, e.currentTarget.value, commitString)}
                onblur={(e) => commitString(row.key, e.currentTarget.value)}
                spellcheck="false"
              />
            {:else if row.shape.kind === 'number'}
              <input
                type="number"
                value={drafts[row.key] ?? String(row.shape.value)}
                oninput={(e) => scheduleFlush(row.key, e.currentTarget.value, commitNumber)}
                onblur={(e) => commitNumber(row.key, e.currentTarget.value)}
              />
            {:else if row.shape.kind === 'boolean'}
              <label class="bool">
                <input
                  type="checkbox"
                  checked={row.shape.value}
                  onchange={(e) => commitBoolean(row.key, e.currentTarget.checked)}
                />
                <span>{row.shape.value ? 'true' : 'false'}</span>
              </label>
            {:else if row.shape.kind === 'date'}
              <input
                type="date"
                value={row.shape.value}
                onchange={(e) => commitDate(row.key, e.currentTarget.value)}
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
            {:else if row.shape.kind === 'yaml'}
              <pre class="yaml">{row.shape.raw}</pre>
              <span class="hint-inline">Edit in source — structured editor doesn't cover this shape.</span>
            {/if}
          </div>
          <button class="row-x" title="Remove property" aria-label="Remove {row.key}" onclick={() => removeKey(row.key)}>×</button>
        </div>
      {/each}
    </div>

    {#if hasFrontmatter || rows.length > 0}
      <div class="add-row">
        <input
          type="text"
          class="key-input"
          placeholder="Add property…"
          bind:value={newKey}
          bind:this={newKeyInputEl}
          onkeydown={(e) => { if (e.key === 'Enter') void addProperty(); }}
        />
        <button class="add-btn" onclick={() => void addProperty()} disabled={!newKey.trim()}>+</button>
      </div>
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

  .row {
    display: grid;
    grid-template-columns: 100px 1fr 18px;
    gap: 6px;
    align-items: center;
    padding: 4px 8px;
    font-size: 12px;
  }

  .row .key {
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row .key:hover,
  .row .key:focus {
    background: var(--bg-button);
    color: var(--text);
    outline: none;
  }

  .row .value {
    min-width: 0;
  }
  .row .value > input[type="text"],
  .row .value > input[type="number"],
  .row .value > input[type="date"] {
    width: 100%;
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 3px 6px;
    color: var(--text);
    font-size: 12px;
    font-family: inherit;
  }
  .row .value > input[type="text"]:hover,
  .row .value > input[type="number"]:hover,
  .row .value > input[type="date"]:hover {
    border-color: var(--border);
  }
  .row .value > input[type="text"]:focus,
  .row .value > input[type="number"]:focus,
  .row .value > input[type="date"]:focus {
    border-color: var(--accent);
    outline: none;
  }

  .bool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
  }

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

  .yaml {
    margin: 0;
    padding: 4px 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
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
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0;
    visibility: hidden;
  }
  .row:hover .row-x { visibility: visible; }
  .row-x:hover { color: var(--text); }

  .add-row {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .key-input {
    flex: 1;
    background: var(--bg-button);
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 3px 6px;
    color: var(--text);
    font-size: 12px;
    font-family: inherit;
  }
  .key-input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .add-btn {
    background: var(--bg-button);
    border: none;
    color: var(--text);
    padding: 0 10px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
  .add-btn:hover { background: var(--bg-button-hover); }
  .add-btn:disabled {
    opacity: 0.5;
    cursor: default;
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
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    white-space: pre-wrap;
    margin-bottom: 4px;
  }
  .error .hint {
    color: var(--text-muted);
    font-size: 11px;
  }
</style>
