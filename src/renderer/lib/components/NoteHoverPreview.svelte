<script lang="ts">
  /**
   * The one link-hover preview (#2710): a note's title and a snippet of its
   * opening (or the linked section), through `makeNotePreviewFetcher` — the
   * same content as hovering a `[[link]]` to that note (#1131, #1132). The
   * Preview pane's wiki-links and the map, Kanban and Timeline views all show
   * this, opened and closed by a `createNoteHover` controller
   * (`note-hover/note-hover.svelte.ts`: the delay, the grace, focus, Escape).
   *
   * Two optional additions, so no view keeps a hover of its own:
   * - a **properties strip** under the snippet: the type's `card:` fields
   *   (`selectInstanceCardFields`) when the host passes an `instance` — or a
   *   loader for one, as the Preview pane does for a typed link target;
   * - **`extra`**, lines under the title only the host knows: the Timeline's
   *   dates, "approximate", and its ⚠ ignored-`end` flag.
   *
   * A `role="tooltip"` the item points at with `aria-describedby`. It never
   * takes focus. The pointer may move onto it (it stays open). It renders into
   * `document.body`, `position: fixed`, so a scrolling board or the map's
   * clipped container can't cut it off, and it follows its anchor while open
   * (re-placed after a scroll, a zoom or a pan). It closes when the anchor
   * leaves the document, on Escape, and on a pointer
   * press outside it. Hosts never mount it in export mode, and it carries
   * `data-export-omit` besides.
   */
  import { onDestroy, tick, untrack, type Snippet } from 'svelte';
  import TypeIcon from './TypeIcon.svelte';
  import { selectInstanceCardFields } from '../../../shared/objects/card';
  import { displayPropertyValue } from '../../../shared/objects/property-display';
  import type { NotePreview, NotePreviewFetcher } from '../editor/note-preview';
  import type { NoteHover } from './note-hover/note-hover.svelte';
  import type { HoverInstance } from './note-hover/hover-instance';
  import { placeHover } from './note-hover/hover-position';
  import { appNotePreviewFetcher } from './note-hover/app-fetcher';
  import { logger } from '../../../shared/logger';

  const log = logger('preview');

  interface Props {
    /** The tooltip's id — what the item's `aria-describedby` names. */
    id: string;
    hover: NoteHover;
    /** Defaults to the app's (`appNotePreviewFetcher`); the Preview pane passes its own, with aliases. */
    fetchPreview?: NotePreviewFetcher;
    /** The properties strip's note, or a loader called with the resolved path. */
    instance?: HoverInstance | null | ((path: string) => Promise<HoverInstance | null>);
    /** Host-specific lines under the title (the Timeline's dates). */
    extra?: Snippet | undefined;
    /** Replaces the quiet "not found" for a target that doesn't resolve. */
    missing?: Snippet<[string]> | undefined;
  }
  let { id, hover, fetchPreview, instance = null, extra, missing }: Props = $props();

  const subject = $derived(hover.current);
  let preview = $state<NotePreview | null>(null);
  let status = $state<'loading' | 'ready' | 'missing'>('loading');
  let loaded = $state<HoverInstance | null>(null);
  let el = $state<HTMLDivElement>();
  let pos = $state<{ left: number; top: number } | null>(null);

  $effect(() => {
    const s = subject;
    if (!s) return;
    let live = true;
    untrack(() => {
      status = 'loading';
      preview = null;
      loaded = null;
      pos = null;
      const fetch = fetchPreview ?? appNotePreviewFetcher();
      const load = typeof instance === 'function' ? instance : null;
      void fetch(s.target).then(async (p) => {
        if (!live) return;
        if (p && load) {
          // No strip is the honest answer when the properties can't be read; the preview still shows.
          const i = await load(p.path).catch((err: unknown) => { log.debug('hover preview: no properties for', p.path, err); return null; });
          if (!live) return;
          loaded = i;
        }
        preview = p;
        status = p ? 'ready' : 'missing';
      }).catch((err: unknown) => {
        log.debug('hover preview: could not read', s.target, err);
        if (live) status = 'missing';
      });
    });
    return () => { live = false; };
  });

  const strip = $derived<HoverInstance | null>(typeof instance === 'function' ? loaded : instance);
  const fields = $derived.by(() => {
    if (!strip) return [];
    const byName = new Map(strip.properties.map((p) => [p.name, p] as const));
    return selectInstanceCardFields(strip.type, strip.properties, strip.inst, { visible: strip.visible ?? null, omit: strip.omit ?? [] }).map((f) => {
      const prop = byName.get(f.name);
      return { name: f.name, label: f.label, text: prop ? (strip.display ?? displayPropertyValue)(prop, f.value) : (f.value ?? '') };
    });
  });
  const title = $derived(preview?.title ?? subject?.fallbackTitle ?? '');
  /** Nothing to show yet: the read is still out and the host gave no title. */
  const waiting = $derived(status === 'loading' && !subject?.fallbackTitle);

  // Placement: on open, and again after anything that can move the anchor — a
  // scroll, a resize, a wheel zoom, a drag pan (pointer moves), a keyboard pan
  // (key up). Event-driven rather than a per-frame loop, which would also never
  // let a fake-timer test settle. An anchor that has left the document closes it.
  function place(): void {
    const s = subject;
    if (!s || !el) return;
    if (!s.anchor.isConnected) { hover.close(); return; }
    const a = s.anchor.getBoundingClientRect();
    const next = placeHover(a, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    if (!pos || pos.left !== next.left || pos.top !== next.top) pos = next;
  }
  const MOVERS = ['scroll', 'resize', 'wheel', 'pointermove', 'keyup'] as const;
  $effect(() => {
    if (!subject || !el) return;
    void status; void fields.length;
    let frame = 0;
    let live = true;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    void tick().then(() => { if (live) place(); });
    for (const type of MOVERS) window.addEventListener(type, schedule, { capture: true, passive: true });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      for (const type of MOVERS) window.removeEventListener(type, schedule, { capture: true });
    };
  });

  // Escape closes; a press anywhere but the preview closes (a drag, a click).
  $effect(() => {
    if (!subject) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hover.close(); };
    const onDown = (e: PointerEvent) => { if (!el?.contains(e.target as Node)) hover.close(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  });

  onDestroy(() => hover.dispose());

  /** Render into `document.body`, out of any scrolling or clipping ancestor. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<div class="nhp-host">
  {#if subject}
    <div
      bind:this={el}
      use:portal
      {id}
      class="note-hover-preview"
      class:nhp-waiting={waiting || pos === null}
      role="tooltip"
      data-export-omit
      data-note-hover-for={subject.key}
      style:left="{pos?.left ?? 0}px"
      style:top="{pos?.top ?? 0}px"
      onpointerenter={() => hover.previewEnter()}
      onpointerleave={() => hover.previewLeave()}
    >
      {#if status === 'missing' && !subject.fallbackTitle}
        {#if missing}{@render missing(subject.target)}{:else}<div class="nhp-missing">“{subject.target}” not found</div>{/if}
      {:else}
        <div class="nhp-title">
          {#if strip?.rowType}<TypeIcon type={strip.rowType} size={13} />{/if}
          <span class="nhp-title-text">{title}</span>
        </div>
        {#if extra}<div class="nhp-extra">{@render extra()}</div>{/if}
        {#if status === 'ready' && preview}
          <div class="nhp-snippet">{preview.snippet || '(empty note)'}</div>
        {:else if status === 'loading'}
          <div class="nhp-snippet nhp-loading">…</div>
        {/if}
        {#if fields.length > 0}
          <dl class="nhp-fields">
            {#each fields as f (f.name)}
              <div class="nhp-field"><dt>{f.label}</dt> <dd>{f.text}</dd></div>
            {/each}
          </dl>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .nhp-host { display: contents; }
  /* The Preview pane's link hover surface (#1132), and the editor's (#1131):
     --bg-button + --text, the pairing that holds in the contrast theme too
     (#2679 / #2688 — --bg-titlebar + --text is the broken one there). */
  .note-hover-preview {
    position: fixed;
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-sizing: border-box;
    min-width: 180px;
    max-width: 360px;
    padding: 10px 12px;
    background: var(--bg-button);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 400;
    font-style: normal;
    line-height: 1.45;
    text-align: left;
  }
  /* Laid out (so it can be measured) but not shown until placed and filled. */
  .nhp-waiting { visibility: hidden; }
  .nhp-title { display: flex; align-items: center; gap: 6px; font-weight: 600; overflow-wrap: anywhere; }
  .nhp-extra { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--text-muted); }
  .nhp-snippet {
    color: var(--text-muted);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 12em;
    overflow: hidden;
  }
  .nhp-missing { color: var(--text-muted); font-style: italic; font-size: 12px; }
  .nhp-fields { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 0; padding-top: 5px; border-top: 1px solid var(--border); }
  .nhp-field { font-size: 11.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nhp-field dt, .nhp-field dd { display: inline; margin: 0; }
  .nhp-field dt { font-weight: 600; }
</style>
