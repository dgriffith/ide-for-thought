<script lang="ts">
  /**
   * *Move to date…*'s bar (#2703): shown above the grid while the calendar is
   * in "choose a day" mode for one event. The grid is the primary picker —
   * focus is on the event's current day, the arrows and Page Up/Down move as
   * they always do, Enter (or a click on a day) moves the event there, Escape
   * cancels — and this bar says so, and offers the other half: a typed date,
   * for a day far off that would take many presses to reach. Its text is the
   * grid's description while choosing, so a screen reader hears the
   * instructions on entering the grid.
   */
  import { parseTypedDay } from './reschedule';

  interface Props {
    /** The event being moved. */
    title: string;
    /** Instructions' id: the grid's `aria-describedby` while choosing. */
    id: string;
    onTyped: (day: number) => void;
    onInvalid: (text: string) => void;
    onCancel: () => void;
  }
  let { title, id, onTyped, onInvalid, onCancel }: Props = $props();

  let typed = $state('');
  let invalid = $state(false);

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    const day = parseTypedDay(typed);
    invalid = day === null;
    if (day === null) onInvalid(typed);
    else onTyped(day);
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form class="cal-movebar" data-calendar-move-bar aria-label="Move {title} to a date" onsubmit={submit} onkeydown={onKeydown}>
  <span class="cal-movebar-text" {id}>Moving <strong>{title}</strong>: choose a day with the arrow keys and press Enter, or type a date. Escape cancels.</span>
  <input
    class="cal-movebar-input"
    type="text"
    inputmode="numeric"
    placeholder="YYYY-MM-DD"
    aria-label="Date to move {title} to"
    aria-invalid={invalid ? 'true' : undefined}
    spellcheck="false"
    autocomplete="off"
    bind:value={typed}
    oninput={() => (invalid = false)}
  />
  <button type="submit" class="cal-movebar-btn">Move</button>
  <button type="button" class="cal-movebar-btn" onclick={onCancel}>Cancel</button>
</form>

<style>
  /* A card surface: --bg-button + --text, the pairing that holds in the contrast theme. */
  .cal-movebar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    margin: 0 12px 6px;
    padding: 6px 8px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
  }
  .cal-movebar-text { flex: 1 1 18em; }
  .cal-movebar-input {
    width: 9em;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .cal-movebar-input[aria-invalid='true'] { border-style: dashed; border-color: var(--text); }
  .cal-movebar-btn {
    padding: 2px 9px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg);
    color: var(--text);
    font-family: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .cal-movebar-btn:hover { border-color: var(--accent); }
</style>
