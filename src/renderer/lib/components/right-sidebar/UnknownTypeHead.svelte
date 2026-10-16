<script lang="ts">
  /**
   * The Properties panel's head for a `type:` no catalog defines (#2635) —
   * most often a plugin's type, with the plugin not in use here. It shows the
   * id with a hint naming the plugin the thoughtbase recommends, if any. A
   * hint, not an error: the note and its frontmatter are left as written.
   *
   * Judged against the loaded catalog rather than the fetched schema, so it
   * can't flash while the schema is still on its way.
   */
  import { objectTypesStore } from '../../stores/object-types.svelte';
  import { getPluginsStore } from '../../stores/plugins.svelte';
  import { getFeatureDialogStore } from '../../stores/feature-dialogs.svelte';
  import { unknownTypeHint } from '../../plugins/unknown-type-hint';
  import type { ValueShape } from '../../../../shared/refactor/frontmatter-rows';

  interface Props {
    /** The note's `type` frontmatter value, if it has one. */
    typeShape: ValueShape | undefined;
  }
  let { typeShape }: Props = $props();

  const plugins = getPluginsStore();
  const featureDialogs = getFeatureDialogStore();

  const typeId = $derived.by(() => {
    if (typeShape?.kind !== 'string' || !objectTypesStore.loaded) return null;
    const id = typeShape.value.trim().toLowerCase();
    if (!id || objectTypesStore.types.some((t) => t.id === id)) return null;
    return id;
  });
  const found = $derived(typeId ? plugins.recommendationsForType(typeId) : null);
</script>

{#if typeId && found}
  <div class="type-head">
    <span class="glyph" aria-hidden="true">?</span>
    <span class="label">{typeId}</span>
  </div>
  <p class="note">
    {unknownTypeHint(typeId, found)}
    {#if found.exact || found.possible.length > 0}
      <button type="button" class="link" onclick={() => featureDialogs.openSettings('plugins')}>Plugins settings…</button>
    {/if}
  </p>
{/if}

<style>
  .type-head {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 12px 6px;
  }
  .glyph {
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px dashed var(--text-muted);
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1;
  }
  .label { font-size: 13px; font-weight: 500; color: var(--text); font-family: var(--font-mono, monospace); }
  .note {
    font-size: 12px;
    color: var(--text-faint);
    padding: 0 12px 8px;
    margin: 0;
  }
  .link {
    border: none;
    background: transparent;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
</style>
