<script lang="ts">
  /**
   * A drafted skill (#2652), shown in the conversation while the turn
   * waits. Every file is shown in full, as main checked it, so what the user
   * saves is what they read. Nothing is written until they choose:
   *
   * - **Save to my skills**: into `~/.minerva/skills/`;
   * - **Save to folder…**: written into a folder they pick;
   * - **Not now**: nothing.
   *
   * Main does the writing, from its own copy of the draft. Like the MCP
   * confirm card, it doesn't take focus when it appears; it's announced. A
   * drafted plugin never comes here: it's a proposal (#2890).
   */
  import type { ExtensionDraftAction, ExtensionDraftOffer } from '../../../../shared/extensions/drafts';

  interface Props {
    offer: ExtensionDraftOffer;
    problem: string | null;
    busy: boolean;
    onAct: (action: ExtensionDraftAction) => void;
  }

  let { offer, problem, busy, onAct }: Props = $props();

  const uid = $props.id();
  const headingId = `extension-draft-${uid}-heading`;
</script>

<section class="extension-draft" role="group" aria-labelledby={headingId} aria-busy={busy} data-testid="extension-draft-card">
  <div class="extension-draft-heading" id={headingId}>
    Drafted skill: <strong>{offer.name}</strong> <code>{offer.id}</code>
  </div>
  <p class="extension-draft-summary">{offer.summary}</p>
  <ul class="extension-draft-files" aria-label="Files">
    {#each offer.files as file (file.path)}
      <li>
        <details>
          <summary><code>{file.path}</code></summary>
          <!-- Scrollable, so it must be reachable by keyboard. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <pre tabindex="0" aria-label={`Contents of ${file.path}`}>{file.content}</pre>
        </details>
      </li>
    {/each}
  </ul>
  {#if problem}
    <p class="extension-draft-problem" role="status">{problem}</p>
  {/if}
  <div class="extension-draft-actions">
    <button type="button" class="extension-draft-primary" disabled={busy} onclick={() => onAct('save')}>
      Save to my skills
    </button>
    <button type="button" disabled={busy} onclick={() => onAct('save-folder')}>Save to folder…</button>
    <button type="button" disabled={busy} onclick={() => onAct('dismiss')}>Not now</button>
  </div>
</section>

<style>
  .extension-draft {
    margin-top: 4px;
    padding: 10px 12px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--bg-button);
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
    color: var(--text);
  }
  .extension-draft-heading { font-size: 13px; font-weight: 600; }
  .extension-draft-heading code { font-family: var(--font-mono, monospace); font-weight: normal; color: var(--text-muted); }
  .extension-draft p { margin: 0; }
  .extension-draft-problem { color: var(--text-muted); }
  .extension-draft-files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .extension-draft-files summary { cursor: pointer; }
  .extension-draft-files code { font-family: var(--font-mono, monospace); }
  .extension-draft-files pre {
    margin: 6px 0 0;
    padding: 6px 8px;
    max-height: 16rem;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    white-space: pre;
  }
  .extension-draft-files pre:focus-visible { outline: 1px solid var(--accent); }
  .extension-draft-actions { display: flex; align-items: center; gap: 6px; }
  .extension-draft-actions button {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .extension-draft-actions button:disabled { opacity: 0.6; cursor: default; }
  .extension-draft-actions .extension-draft-primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--bg);
  }
</style>
