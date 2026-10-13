<script lang="ts">
  /**
   * Property filters in the view panel (#2533, epic #2530): the active
   * filters as removable chips, and a Filter ▾ popover to add or edit one.
   *
   * - text / enum / link → tick values present in the view's folder scope
   *   (offered from the unfiltered set, so ticking one doesn't hide the
   *   others), with counts;
   * - number / date → a min / max range;
   * - Type (#2716) → the view type's subtypes as an indented tree, with
   *   counts — offered only when the type has a subtype. Stored as a values
   *   filter on the reserved key `type`, matched hierarchically
   *   (`view-spec.ts`).
   * - Tags (#2768) → the tags the view's notes carry, with counts, and whether
   *   a note needs any, all or none of the ticked ones. Stored on the reserved
   *   key `tags`; a tag also matches the tags nested under it.
   *
   * Changes apply as you make them (the view refilters live). Only the panel
   * mounts this: an embed or export shows the filtered objects, no controls.
   */
  import { tick } from 'svelte';
  import type { PropertyDef, TypeInstanceRow } from '../../../shared/objects/type-def';
  import { isValuesFilter, normalizeTag, TAGS_FILTER_KEY, TAG_MATCHES, TYPE_FILTER_KEY, type TagMatch, type ViewFilter } from '../../../shared/objects/view-spec';
  import type { SubtypeChoice } from '../../../shared/objects/type-filter';
  import { isDateType } from '../../../shared/objects/date-values';

  interface Props {
    /** The type's (effective) properties. */
    properties: PropertyDef[];
    /** Instances in the view's folder scope, before filtering. */
    instances: TypeInstanceRow[];
    filters: ViewFilter[];
    /** How the view shows a value (a link's target by name, etc.). */
    display: (prop: PropertyDef, value: string | null) => string;
    onChange: (filters: ViewFilter[]) => void;
    /** The view type's subtypes with counts (#2716); empty → no Type filter. */
    subtypes?: SubtypeChoice[];
  }
  let { properties, instances, filters, display, onChange, subtypes = [] }: Props = $props();

  // `type` and `tags` are reserved keys, never a property's (#2716, #2768).
  const filterable = $derived(properties.filter((p) => p.type !== 'geo' && p.name !== TYPE_FILTER_KEY && p.name !== TAGS_FILTER_KEY));

  /** Each tag the view's notes carry, as first written, with how many carry it. */
  const presentTags = $derived.by(() => {
    const byKey = new Map<string, { tag: string; count: number }>();
    for (const inst of instances) {
      for (const tag of new Set((inst.tags ?? []).map(normalizeTag))) {
        const seen = byKey.get(tag);
        if (seen) seen.count++;
        else byKey.set(tag, { tag: (inst.tags ?? []).find((t) => normalizeTag(t) === tag) ?? tag, count: 1 });
      }
    }
    return [...byKey.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  });
  const MATCH_LABELS: Record<TagMatch, string> = { any: 'Any', all: 'All', none: 'None' };
  /** How tags combine before any is ticked — taken up by the first one. */
  let pendingMatch = $state<TagMatch>('any');
  const offersTags = $derived(presentTags.length > 0 || filters.some((f) => f.property === TAGS_FILTER_KEY));
  const typeLabel = (id: string) => subtypes.find((t) => t.id === id)?.label ?? id;
  const isRange = (p: PropertyDef) => p.type === 'number' || isDateType(p.type);
  /** What a bound looks like: a date may be as coarse as a year (`1969`). */
  const boundPlaceholder = (p: PropertyDef) => (p.type === 'date' ? 'YYYY-MM-DD' : p.type === 'datetime' ? 'YYYY-MM-DDTHH:mm' : '');

  let open = $state(false);
  let editing = $state<string | null>(null);
  let popoverEl = $state<HTMLDivElement>();
  let rootEl = $state<HTMLDivElement>();

  // Close on a press outside. `pointerdown`, not `click`: choosing a property
  // swaps the popover's contents, so by `click` time the pressed button is
  // detached and would read as outside.
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootEl && !rootEl.contains(e.target as Node)) open = false;
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });

  const editingProp = $derived(filterable.find((p) => p.name === editing) ?? null);
  const current = (name: string) => filters.find((f) => f.property === name);

  /** Each value present for a property, with its count, as the view shows it. */
  function presentValues(prop: PropertyDef): Array<{ value: string; label: string; count: number }> {
    const counts = new Map<string, number>();
    for (const inst of instances) {
      const v = inst.values[prop.name];
      if (v !== null && v !== undefined && v !== '') counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, label: display(prop, value), count }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }

  function replace(name: string, next: ViewFilter | null): void {
    const rest = filters.filter((f) => f.property !== name);
    onChange(next ? [...rest, next] : rest);
  }

  function toggleValue(name: string, value: string): void {
    const f = current(name);
    const values = new Set(f && isValuesFilter(f) ? f.values : []);
    if (values.has(value)) values.delete(value); else values.add(value);
    // A tags filter keeps how its tags combine as they're ticked and unticked.
    const kept = f && isValuesFilter(f) ? f.match : name === TAGS_FILTER_KEY ? pendingMatch : undefined;
    const match = kept && kept !== 'any' ? { match: kept } : {};
    replace(name, values.size > 0 ? { property: name, values: [...values], ...match } : null);
  }

  function setMatch(match: TagMatch): void {
    pendingMatch = match;
    const f = current(TAGS_FILTER_KEY);
    if (!f || !isValuesFilter(f)) return;
    const { match: _old, ...rest } = f;
    replace(TAGS_FILTER_KEY, match === 'any' ? rest : { ...rest, match });
  }

  function setBound(name: string, bound: 'min' | 'max', raw: string): void {
    const f = current(name);
    const prev = f && !isValuesFilter(f) ? f : { property: name, min: null, max: null };
    const next = { property: name, min: prev.min ?? null, max: prev.max ?? null, [bound]: raw.trim() === '' ? null : raw.trim() };
    replace(name, next.min === null && next.max === null ? null : next);
  }

  /** What a filter selects: "Prague, Brno" / "≥ 4" / "from 2026-05" / "4 – 9". */
  function valueSummary(f: ViewFilter): string {
    const prop = filterable.find((p) => p.name === f.property);
    if (isValuesFilter(f)) {
      const shown = f.values.map((v) => (f.property === TYPE_FILTER_KEY ? typeLabel(v) : prop ? display(prop, v) : v));
      return shown.length > 2 ? `${shown.slice(0, 2).join(', ')} +${shown.length - 2}` : shown.join(', ');
    }
    const min = f.min ?? null;
    const max = f.max ?? null;
    if (min !== null && max !== null) return `${min} – ${max}`;
    if (isDateType(prop?.type)) return min !== null ? `from ${min}` : `until ${max}`;
    return min !== null ? `≥ ${min}` : `≤ ${max}`;
  }

  /** "City: Prague, Brno" — a chip, and its remove button's label. */
  function chipText(f: ViewFilter): string {
    const prop = filterable.find((p) => p.name === f.property);
    if (f.property === TAGS_FILTER_KEY) {
      const match = isValuesFilter(f) && f.match && f.match !== 'any' ? ` (${f.match})` : '';
      return `Tags${match}: ${valueSummary(f)}`;
    }
    const name = f.property === TYPE_FILTER_KEY ? 'Type' : prop?.label ?? f.property;
    return `${name}: ${valueSummary(f)}`;
  }

  async function openAt(name: string | null): Promise<void> {
    editing = name;
    open = true;
    await tick();
    popoverEl?.querySelector<HTMLElement>('input, button')?.focus();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); open = false; }
  }
</script>

{#if filterable.length > 0 || subtypes.length > 0 || offersTags}
  <div class="tv-filters" bind:this={rootEl}>
    {#each filters as f (f.property)}
      <span class="tv-filter-chip">
        <button type="button" class="tv-filter-label" onclick={() => openAt(f.property)} title="Edit this filter">{chipText(f)}</button>
        <button type="button" class="tv-filter-x" aria-label="Remove filter {chipText(f)}" onclick={() => replace(f.property, null)}>✕</button>
      </span>
    {/each}
    <div class="tv-filter-anchor">
      <button type="button" class="tv-btn" aria-expanded={open} aria-haspopup="dialog" onclick={() => (open ? (open = false) : void openAt(null))}>Filter ▾</button>
      {#if open}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="tv-filter-popover" role="dialog" aria-label="Filter by property" tabindex="-1" bind:this={popoverEl} onkeydown={onKeydown}>
          {#if editing === TYPE_FILTER_KEY && subtypes.length > 0}
            {@const f = current(TYPE_FILTER_KEY)}
            <div class="tv-filter-head">
              <button type="button" class="tv-filter-back" aria-label="All properties" onclick={() => openAt(null)}>‹</button>
              <span>Type</span>
              {#if f}<button type="button" class="tv-filter-clear" onclick={() => replace(TYPE_FILTER_KEY, null)}>Clear</button>{/if}
            </div>
            <ul class="tv-filter-values" aria-label="Subtypes">
              {#each subtypes as t (t.id)}
                <li><label style="padding-left: {4 + t.depth * 16}px">
                  <input type="checkbox" checked={!!f && isValuesFilter(f) && f.values.includes(t.id)} onchange={() => toggleValue(TYPE_FILTER_KEY, t.id)} />
                  {#if t.icon}<span class="tv-filter-icon" aria-hidden="true">{t.icon}</span>{/if}
                  <span class="tv-filter-value">{t.label}</span><span class="tv-filter-count">{t.count}</span>
                </label></li>
              {/each}
            </ul>
          {:else if editing === TAGS_FILTER_KEY}
            {@const f = current(TAGS_FILTER_KEY)}
            {@const match = f && isValuesFilter(f) ? f.match ?? 'any' : pendingMatch}
            <div class="tv-filter-head">
              <button type="button" class="tv-filter-back" aria-label="All properties" onclick={() => openAt(null)}>‹</button>
              <span>Tags</span>
              {#if f}<button type="button" class="tv-filter-clear" onclick={() => replace(TAGS_FILTER_KEY, null)}>Clear</button>{/if}
            </div>
            <div class="tv-filter-match" role="radiogroup" aria-label="A note needs">
              {#each TAG_MATCHES as m (m)}
                <label><input type="radio" name="tv-tag-match" checked={match === m} onchange={() => setMatch(m)} />{MATCH_LABELS[m]}</label>
              {/each}
            </div>
            {#if presentTags.length === 0}
              <p class="tv-filter-empty">No tags in this view.</p>
            {:else}
              <ul class="tv-filter-values" aria-label="Tags">
                {#each presentTags as t (t.tag)}
                  <li><label>
                    <input type="checkbox" checked={!!f && isValuesFilter(f) && f.values.some((v) => normalizeTag(v) === normalizeTag(t.tag))} onchange={() => toggleValue(TAGS_FILTER_KEY, t.tag)} />
                    <span class="tv-filter-value">#{t.tag.replace(/^#/, '')}</span><span class="tv-filter-count">{t.count}</span>
                  </label></li>
                {/each}
              </ul>
            {/if}
          {:else if !editingProp}
            <ul class="tv-filter-props">
              {#if subtypes.length > 0}
                {@const f = current(TYPE_FILTER_KEY)}
                <li><button type="button" onclick={() => openAt(TYPE_FILTER_KEY)}>
                  <span>Type</span>
                  {#if f}<span class="tv-filter-active">{valueSummary(f)}</span>{/if}
                </button></li>
              {/if}
              {#if offersTags}
                {@const f = current(TAGS_FILTER_KEY)}
                <li><button type="button" onclick={() => openAt(TAGS_FILTER_KEY)}>
                  <span>Tags</span>
                  {#if f}<span class="tv-filter-active">{valueSummary(f)}</span>{/if}
                </button></li>
              {/if}
              {#each filterable as p (p.name)}
                {@const f = current(p.name)}
                <li><button type="button" onclick={() => openAt(p.name)}>
                  <span>{p.label ?? p.name}</span>
                  {#if f}<span class="tv-filter-active">{valueSummary(f)}</span>{/if}
                </button></li>
              {/each}
            </ul>
          {:else}
            {@const prop = editingProp}
            <div class="tv-filter-head">
              <button type="button" class="tv-filter-back" aria-label="All properties" onclick={() => openAt(null)}>‹</button>
              <span>{prop.label ?? prop.name}</span>
              {#if current(prop.name)}<button type="button" class="tv-filter-clear" onclick={() => replace(prop.name, null)}>Clear</button>{/if}
            </div>
            {#if isRange(prop)}
              {@const f = current(prop.name)}
              {@const range = f && !isValuesFilter(f) ? f : null}
              <div class="tv-filter-range">
                <label>Min
                  <input type={prop.type === 'number' ? 'number' : 'text'} placeholder={boundPlaceholder(prop)} value={range?.min ?? ''} onchange={(e) => setBound(prop.name, 'min', e.currentTarget.value)} />
                </label>
                <label>Max
                  <input type={prop.type === 'number' ? 'number' : 'text'} placeholder={boundPlaceholder(prop)} value={range?.max ?? ''} onchange={(e) => setBound(prop.name, 'max', e.currentTarget.value)} />
                </label>
              </div>
            {:else}
              {@const values = presentValues(prop)}
              {@const f = current(prop.name)}
              {#if values.length === 0}
                <p class="tv-filter-empty">No values in this view.</p>
              {:else}
                <ul class="tv-filter-values">
                  {#each values as v (v.value)}
                    <li><label>
                      <input type="checkbox" checked={!!f && isValuesFilter(f) && f.values.includes(v.value)} onchange={() => toggleValue(prop.name, v.value)} />
                      <span class="tv-filter-value">{v.label}</span><span class="tv-filter-count">{v.count}</span>
                    </label></li>
                  {/each}
                </ul>
              {/if}
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .tv-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .tv-filter-chip { display: inline-flex; align-items: center; border-radius: 999px; background: color-mix(in oklch, var(--accent) 14%, var(--bg-button)); font-size: 11.5px; }
  .tv-filter-label, .tv-filter-x { border: none; background: transparent; color: var(--text); font: inherit; cursor: pointer; padding: 1px 4px; }
  .tv-filter-label { padding-left: 8px; }
  .tv-filter-x { color: var(--text-muted); padding-right: 7px; font-size: 10px; }
  .tv-filter-x:hover { color: var(--text); }
  .tv-filter-anchor { position: relative; }
  .tv-btn { padding: 3px 10px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg-button); color: var(--text-muted); font-family: inherit; font-size: 11.5px; cursor: pointer; }
  .tv-btn:hover { color: var(--text); border-color: var(--accent); }
  .tv-filter-popover { position: absolute; left: 0; top: calc(100% + 4px); z-index: 20; min-width: 220px; max-height: 320px; overflow: auto; padding: 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elevated, var(--bg)); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
  .tv-filter-props, .tv-filter-values { list-style: none; margin: 0; padding: 0; }
  .tv-filter-props button { display: flex; justify-content: space-between; gap: 12px; width: 100%; padding: 4px 6px; border: none; border-radius: 4px; background: transparent; color: var(--text); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
  .tv-filter-props button:hover, .tv-filter-props button:focus-visible { background: color-mix(in oklch, var(--text) 6%, transparent); outline: none; }
  .tv-filter-active { color: var(--text-muted); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tv-filter-head { display: flex; align-items: center; gap: 6px; padding: 2px 2px 6px; font-size: 12px; font-weight: 600; color: var(--text); }
  .tv-filter-back, .tv-filter-clear { border: none; background: transparent; color: var(--text-muted); font: inherit; cursor: pointer; padding: 0 4px; }
  .tv-filter-clear { margin-left: auto; font-weight: 400; }
  .tv-filter-back:hover, .tv-filter-clear:hover { color: var(--text); }
  .tv-filter-values label { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 4px; font-size: 12px; color: var(--text); cursor: pointer; }
  .tv-filter-values label:hover { background: color-mix(in oklch, var(--text) 5%, transparent); }
  .tv-filter-icon { font-size: 12px; line-height: 1; }
  .tv-filter-count { margin-left: auto; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .tv-filter-range { display: flex; gap: 8px; padding: 2px; }
  .tv-filter-match { display: flex; gap: 10px; padding: 0 4px 6px; font-size: 12px; color: var(--text-muted); }
  .tv-filter-match label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .tv-filter-range label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--text-muted); }
  .tv-filter-range input { width: 100px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-inset); color: var(--text); font: inherit; font-size: 12px; }
  .tv-filter-empty { margin: 4px; font-size: 12px; color: var(--text-muted); }
</style>
