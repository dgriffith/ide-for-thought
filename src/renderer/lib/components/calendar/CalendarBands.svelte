<script lang="ts">
  /**
   * A calendar page's month and year bands (#2702, decision 3 on #2699): the
   * notes whose start is only a month (`1969-07`) or only a year (`1969`),
   * listed on every page their range meets (`pageBands`) — never spread
   * across the cells, which would claim a day the value doesn't have. Each is
   * marked "since …" / "until …" where its range runs past the page, and drawn
   * as a dashed chip, the grid's approximate style.
   *
   * Ordinary buttons, one tab stop each, AFTER the grid in tab order (the
   * vision doc's keyboard model) though shown above it (`order: -1` in the
   * calendar's column). Focus and hover show the shared hover preview. In an
   * export (#2704) they follow the grid on the page too, as links.
   */
  import type { BandEntry } from './calendar-model';
  import type { NoteHover } from '../note-hover/note-hover.svelte';

  interface Band {
    id: 'year' | 'month';
    /** "2026 · no month", "October 2026 · no day". */
    head: string;
    entries: BandEntry[];
  }
  interface Props {
    bands: Band[];
    hover: NoteHover;
    cardId: string;
    cardKey: string | null;
    exportMode: boolean;
    onOpenNote: (path: string) => void;
  }
  let { bands, hover, cardId, cardKey, exportMode, onOpenNote }: Props = $props();

  const uid = $props.id();
  const shown = $derived(bands.filter((b) => b.entries.length > 0));
  const subject = (b: BandEntry, anchor: Element) => ({ key: b.ev.key, target: b.ev.key, anchor, fallbackTitle: b.ev.title });
</script>

{#if shown.length > 0}
  <div class="cal-bands" class:cal-bands-export={exportMode}>
    {#each shown as band (band.id)}
      <section class="cal-band" data-band={band.id} aria-labelledby="{uid}-{band.id}">
        <h3 class="cal-band-head" id="{uid}-{band.id}">{band.head}</h3>
        <ul class="cal-band-list">
          {#each band.entries as b (b.ev.key)}
            <li>
              <button
                type="button"
                class="cal-chip"
                data-note-path={b.ev.key}
                aria-describedby={cardKey === b.ev.key ? cardId : undefined}
                onclick={() => onOpenNote(b.ev.key)}
                onfocus={(e) => { if (!exportMode) hover.focus(subject(b, e.currentTarget)); }}
                onblur={() => hover.blur(b.ev.key)}
                onpointerenter={(e) => { if (!exportMode) hover.pointerEnter(subject(b, e.currentTarget)); }}
                onpointerleave={() => hover.pointerLeave(b.ev.key)}
              >
                <span class="cal-chip-title">{b.ev.title}</span>
                <span class="cal-chip-date">{b.ev.dateText}</span>
                {#if b.since}<span class="cal-chip-mark" data-since>{b.since}</span>{/if}
                {#if b.until}<span class="cal-chip-mark" data-until>{b.until}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/if}

<style>
  /* Above the grid on the page, after it for the keyboard. */
  .cal-bands { order: -1; flex-shrink: 0; max-height: 30%; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding: 0 12px 6px; }
  .cal-bands-export { order: 0; max-height: none; overflow: visible; padding-top: 8px; }
  .cal-bands-export .cal-chip { cursor: default; }
  .cal-band { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .cal-band-head { margin: 0; font-size: 11.5px; font-weight: 600; color: var(--text); white-space: nowrap; }
  .cal-band-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; }
  /* A chip surface: --bg-button + --text (the contrast-theme pairing, #2679 / #2688), dashed: approximate. */
  .cal-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 1px 7px;
    border: 1px dashed var(--accent);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .cal-chip:hover { border-style: solid; }
  .cal-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .cal-chip-title { font-weight: 500; }
  .cal-chip-date, .cal-chip-mark { font-size: 11px; }
  .cal-chip-mark { font-style: italic; }
</style>
