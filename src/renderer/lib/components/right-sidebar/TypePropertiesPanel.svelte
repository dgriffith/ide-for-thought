<script lang="ts">
  /**
   * Typed-property form (#1066). For a note with a `type:`, renders the type's
   * declared properties as typed inputs — the frontmatter updates underneath, so
   * the user never hand-writes YAML. Schema comes from the #1063 read-back;
   * VALUES are read from the live editor content (instant, reflects hand-edits
   * with no reindex round-trip); edits write through the shared YAML patch.
   *
   * Nothing is ever required — clearing a field just empties the key. Raw
   * frontmatter stays the escape hatch (the Properties tab + the note itself).
   */
  import { api } from '../../ipc/client';
  import { getFrontmatterValues, setFrontmatterProperty } from '../../../../shared/frontmatter-edit';
  import type { NoteTypedProperties } from '../../../../shared/objects/type-def';

  interface Props {
    activeFilePath: string | null;
    content: string;
    onContentChange?: (next: string) => void;
    /** Bumped on reindex; re-fetches the schema so a hand-edited `type:` shows. */
    revision?: number;
  }

  let { activeFilePath, content, onContentChange, revision = 0 }: Props = $props();

  let schema = $state<NoteTypedProperties>({ type: null, properties: [] });

  $effect(() => {
    const path = activeFilePath;
    void revision; // re-fetch on reindex (catches a hand-changed `type:`)
    if (!path) { schema = { type: null, properties: [] }; return; }
    let cancelled = false;
    void api.types.noteProperties(path).then((r) => { if (!cancelled) schema = r; });
    return () => { cancelled = true; };
  });

  const values = $derived(getFrontmatterValues(content));

  function commit(name: string, raw: string, numeric: boolean) {
    if (!onContentChange) return;
    if (raw.trim() === '') { onContentChange(setFrontmatterProperty(content, name, '')); return; }
    if (numeric) {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      onContentChange(setFrontmatterProperty(content, name, n));
      return;
    }
    onContentChange(setFrontmatterProperty(content, name, raw));
  }
</script>

<div class="type-props">
  {#if schema.type}
    <div class="type-head">
      <span class="type-icon">{schema.type.icon ?? '◆'}</span>
      <span class="type-label">{schema.type.label}</span>
    </div>
    {#if schema.properties.length === 0}
      <p class="empty">This type declares no properties.</p>
    {:else}
      {#each schema.properties as p (p.name)}
        {@const v = values[p.name] ?? ''}
        <label class="field">
          <span class="field-label">{p.label ?? p.name}</span>
          {#if p.type === 'enum'}
            <select value={v} onchange={(e) => commit(p.name, e.currentTarget.value, false)}>
              <option value=""></option>
              {#each p.options ?? [] as opt (opt)}<option value={opt}>{opt}</option>{/each}
            </select>
          {:else if p.type === 'number'}
            <input type="number" value={v} onchange={(e) => commit(p.name, e.currentTarget.value, true)} />
          {:else if p.type === 'date'}
            <input type="date" value={v} onchange={(e) => commit(p.name, e.currentTarget.value, false)} />
          {:else}
            <input
              type="text"
              value={v}
              placeholder={p.type === 'link-to-type' ? '[[Note]]' : ''}
              onchange={(e) => commit(p.name, e.currentTarget.value, false)}
            />
          {/if}
        </label>
      {/each}
    {/if}
  {:else}
    <p class="empty">
      This note has no type. Create a note as a type, or add <code>type:</code> to its
      frontmatter, to edit properties as a form.
    </p>
  {/if}
</div>

<style>
  .type-props {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px;
  }
  .type-head {
    display: flex;
    align-items: center;
    gap: 7px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .type-icon { font-size: 14px; line-height: 1; }
  .type-label { font-size: 13px; font-weight: 600; color: var(--text); }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .field-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .field input,
  .field select {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-inset);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12.5px;
    box-sizing: border-box;
  }
  .field input:focus,
  .field select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .empty {
    font-size: 12px;
    color: var(--text-faint);
    line-height: 1.5;
    margin: 4px 0;
  }
  .empty code {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg-inset);
    padding: 1px 4px;
    border-radius: 3px;
  }
</style>
