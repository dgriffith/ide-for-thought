<script lang="ts">
  /**
   * Keyboard Shortcuts reference (#804). Launched from Help ▸ Keyboard Shortcuts
   * (App wires `api.menu.onShortcuts`). Pulls the live accelerators from main —
   * generated from the real menu, so it never drifts from what the menu binds.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-close and backdrop-click
   * are Dialog's job; this component has nothing else to handle.
   */
  import { api } from '../ipc/client';
  import type { ShortcutGroup } from '../ipc/client';
  import Dialog from './ui/Dialog.svelte';
  import Kbd from './ui/Kbd.svelte';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  let groups = $state<ShortcutGroup[]>([]);
  $effect(() => { void api.app.getShortcuts().then((g) => { groups = g; }); });
</script>

<Dialog width={640} onClose={onClose} titleId="shortcuts-title">
  {#snippet eyebrow()}Help{/snippet}
  {#snippet title()}Keyboard Shortcuts{/snippet}
  {#snippet body()}
    {#if groups.length === 0}
      <p class="empty">No shortcuts to show.</p>
    {:else}
      <div class="cols">
        {#each groups as group (group.menu)}
          <section class="group">
            <h3>{group.menu}</h3>
            <ul>
              {#each group.items as item (item.label + item.keys)}
                <li>
                  <span class="label">{item.label}</span>
                  <Kbd>{item.keys}</Kbd>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {/if}
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">esc · close</span>{/snippet}
  {#snippet footerRight()}<button class="btn primary" onclick={onClose}>Done</button>{/snippet}
</Dialog>

<style>
  .cols {
    columns: 2;
    column-gap: 28px;
  }
  .group {
    break-inside: avoid;
    margin-bottom: 16px;
  }
  .group h3 {
    margin: 0 0 6px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 0;
    font-size: 12.5px;
  }
  .label {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    color: var(--text-muted);
    font-size: 12px;
  }
  .kbd-hint {
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .btn {
    padding: 7px 16px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .primary:hover { opacity: 0.92; }
</style>
