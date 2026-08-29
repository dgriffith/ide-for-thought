<script lang="ts">
  /**
   * Behaviors settings panel (#1600) — extracted from SettingsDialog. Owns the
   * per-change sidebar / breadcrumbs / conversations toggles and the
   * confirmation-dialog suppression list. Each persists immediately (no
   * Done-batch), so the panel is fully self-contained.
   */
  import { getSidebarSettings, setSidebarSettings, type SidebarSettings } from '../sidebar/settings';
  import { getBreadcrumbsSettings, setBreadcrumbsSettings, type BreadcrumbsSettings } from '../breadcrumbs/settings';
  import { getConversationsSettings, setConversationsSettings, type ConversationsSettings } from '../conversations/settings';
  import { getConfirmSuppressionStore } from '../stores/confirm-suppression.svelte';
  import { CONFIRM_REGISTRY, confirmRegistryEntry } from '../confirm-keys';
  import { makePatch } from '../make-patch';

  let sidebar = $state<SidebarSettings>({ ...getSidebarSettings() });
  const patchSidebar = makePatch(() => sidebar, (v) => { sidebar = v; }, setSidebarSettings);

  let breadcrumbs = $state<BreadcrumbsSettings>({ ...getBreadcrumbsSettings() });
  const patchBreadcrumbs = makePatch(() => breadcrumbs, (v) => { breadcrumbs = v; }, setBreadcrumbsSettings);

  let conversations = $state<ConversationsSettings>({ ...getConversationsSettings() });
  const patchConversations = makePatch(() => conversations, (v) => { conversations = v; }, setConversationsSettings);

  const confirmSuppression = getConfirmSuppressionStore();
  // Every registered confirm, paired with its current suppressed flag — binds to
  // the store's $state so toggling re-enables updates the row live.
  let confirmRows = $derived(
    CONFIRM_REGISTRY.map((entry) => ({
      entry,
      suppressed: confirmSuppression.suppressed.has(entry.key),
    })),
  );
  // Unknown keys left in localStorage by older builds — still re-enableable.
  let orphanSuppressedKeys = $derived(
    [...confirmSuppression.suppressed].filter((k) => !confirmRegistryEntry(k)),
  );
</script>

<div class="behaviors">
      <div class="field checkbox">
        <label>
          <input
            type="checkbox"
            checked={sidebar.autoReveal}
            onchange={(e) => patchSidebar({ autoReveal: e.currentTarget.checked })}
          />
          Auto-reveal active file in sidebar
        </label>
        <p class="hint">
          When the active editor changes, scroll the matching row into view in the
          Notes panel and expand its parent folders. Never collapses anything you've
          already opened.
        </p>
      </div>
      <div class="field checkbox">
        <label>
          <input
            type="checkbox"
            checked={breadcrumbs.showHeadingChain}
            onchange={(e) => patchBreadcrumbs({ showHeadingChain: e.currentTarget.checked })}
          />
          Show heading chain in breadcrumbs
        </label>
        <p class="hint">
          Append the current section's heading chain to the breadcrumbs bar above
          the editor when the cursor sits inside a section. Updates as the cursor
          moves between sections.
        </p>
      </div>
      <div class="field checkbox">
        <label>
          <input
            type="checkbox"
            checked={conversations.openOnLoad}
            onchange={(e) => patchConversations({ openOnLoad: e.currentTarget.checked })}
          />
          Open Conversations on project load
        </label>
        <p class="hint">
          Show the Conversations panel automatically each time a thoughtbase opens.
          Off by default — the panel launches hidden and you toggle it with
          ⌘/Ctrl+Shift+K.
        </p>
      </div>
      <div class="field">
        <span class="field-label">Confirmation dialogs</span>
        <p class="hint">
          Uncheck a dialog to stop it asking — the same as ticking "Don't ask
          again" when it appears. Re-check it to see the prompt next time.
        </p>
      </div>
      {#each confirmRows as row}
        <div class="field checkbox">
          <label>
            <input
              type="checkbox"
              checked={!row.suppressed}
              onchange={(e) =>
                e.currentTarget.checked
                  ? confirmSuppression.unsuppress(row.entry.key)
                  : confirmSuppression.suppress(row.entry.key)}
            />
            {row.entry.title}
          </label>
          <p class="hint">{row.entry.description}</p>
        </div>
      {/each}
      {#each orphanSuppressedKeys as key}
        <div class="field checkbox">
          <label>
            <input
              type="checkbox"
              checked={false}
              onchange={() => confirmSuppression.unsuppress(key)}
            />
            Unknown confirmation
          </label>
          <p class="hint mono">{key}</p>
        </div>
      {/each}
</div>

<style>
  /* Field styles mirror SettingsDialog's shared panel styles (each extracted
     panel carries its own copy). The 14px gap matches the parent .panel. */
  .behaviors {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  /* Base .field shape shared via global.css (#1910). */
  .field label {
    color: var(--text);
  }
  .field.checkbox label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .field input[type="checkbox"] {
    cursor: pointer;
  }
  .hint {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
  .hint.mono {
    font-family: ui-monospace, monospace;
  }
</style>
