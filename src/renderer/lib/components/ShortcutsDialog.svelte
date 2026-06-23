<script lang="ts">
  /**
   * Keyboard Shortcuts reference (#804). Launched from Help ▸ Keyboard Shortcuts
   * (App wires `api.menu.onShortcuts`). Pulls the live accelerators from main —
   * generated from the real menu, so it never drifts from what the menu binds.
   */
  import { api } from '../ipc/client';
  import type { ShortcutGroup } from '../ipc/client';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  let groups = $state<ShortcutGroup[]>([]);
  $effect(() => { void api.app.getShortcuts().then((g) => { groups = g; }); });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
    <header class="card-header">
      <div class="eyebrow">Help</div>
      <h2 class="title" id="shortcuts-title">Keyboard Shortcuts</h2>
    </header>

    <div class="body">
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
                    <kbd>{item.keys}</kbd>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · close</span>
      <button class="btn primary" onclick={onClose}>Done</button>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(20, 14, 6, 0.5);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    width: 640px;
    max-width: 100%;
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
  }
  .card-header {
    padding: 20px 24px 0;
  }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 500;
    color: var(--text);
  }
  .body {
    padding: 16px 24px;
    overflow-y: auto;
  }
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
  kbd {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 6px;
  }
  .empty {
    color: var(--text-muted);
    font-size: 12px;
  }
  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .kbd-hint {
    margin-right: auto;
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
