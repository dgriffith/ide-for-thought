<script lang="ts">
  /**
   * The inline confirmation card for an `mcp_call` to a tool its server did
   * not mark read-only (#2439). Shown in the transcript while the turn waits;
   * nothing reaches the server until the user clicks Allow.
   *
   * It shows exactly what will be sent: the server, the tool, the server's own
   * description of it, and `argsJson` VERBATIM — main serialized the arguments
   * once and sends that same object, so the user reviews the bytes an injected
   * instruction chose, not a re-rendering of them.
   *
   * Keyboard: Enter allows, Escape denies, anywhere inside the card (a focused
   * button or the Arguments toggle keeps its own Enter). The card deliberately
   * does NOT take focus when it appears: the user may be typing elsewhere, and
   * an Enter meant for the editor must never approve a call. It is announced
   * to screen readers instead (`conversations.svelte.ts`).
   *
   * No danger styling (CLAUDE.md, UX): allowing a tool is a normal decision.
   */
  import type { McpConfirmRequest } from '../../../../shared/conversation-tools';

  interface Props {
    request: McpConfirmRequest;
    onAnswer: (allow: boolean, remember: boolean) => void;
  }

  let { request, onAnswer }: Props = $props();

  let remember = $state(false);
  const uid = $props.id();
  const headingId = `mcp-confirm-${uid}-heading`;
  const descId = `mcp-confirm-${uid}-desc`;

  let argLines = $derived(request.argsJson.split('\n').length);
  let showTitle = $derived(!!request.title && request.title !== request.toolName);

  function allow(): void {
    onAnswer(true, remember);
  }

  function deny(): void {
    onAnswer(false, false);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      deny();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    // A focused button or the <summary> toggle does its own thing on Enter.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'BUTTON' || target.tagName === 'SUMMARY')) return;
    e.preventDefault();
    allow();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="mcp-confirm"
  role="group"
  aria-labelledby={headingId}
  aria-describedby={descId}
  onkeydown={onKeydown}
  data-testid="mcp-confirm-card"
>
  <div class="mcp-confirm-heading" id={headingId}>
    Allow <code>{request.toolName}</code> on <strong>{request.serverName}</strong>?
  </div>
  <div class="mcp-confirm-desc" id={descId}>
    {#if showTitle}<div class="mcp-confirm-title">{request.title}</div>{/if}
    {#if request.description}<p>{request.description}</p>{/if}
    <p class="mcp-confirm-note">
      The server doesn't mark this tool as read-only{#if request.destructiveHint === true}, and marks it as destructive{/if}.
      Nothing is sent until you allow it.
    </p>
  </div>
  <details class="mcp-confirm-args" open>
    <summary>Arguments ({argLines} {argLines === 1 ? 'line' : 'lines'})</summary>
    <!-- Scrollable, so it must be reachable by keyboard. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <pre tabindex="0" aria-label="Arguments that will be sent">{request.argsJson}</pre>
  </details>
  <label class="mcp-confirm-remember">
    <input type="checkbox" bind:checked={remember} />
    Don't ask again for this tool
  </label>
  <div class="mcp-confirm-actions">
    <button type="button" class="mcp-confirm-allow" onclick={allow}>Allow</button>
    <button type="button" class="mcp-confirm-deny" onclick={deny}>Deny</button>
    <span class="mcp-confirm-hint" aria-hidden="true">Enter to allow · Esc to deny</span>
  </div>
</section>

<style>
  .mcp-confirm {
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
  .mcp-confirm-heading { font-size: 13px; font-weight: 600; }
  .mcp-confirm-heading code { font-family: var(--font-mono, monospace); }
  .mcp-confirm-desc { display: flex; flex-direction: column; gap: 4px; }
  .mcp-confirm-desc p { margin: 0; }
  .mcp-confirm-title { font-weight: 600; }
  .mcp-confirm-note { color: var(--text-muted); }
  .mcp-confirm-args summary { cursor: pointer; color: var(--text-muted); }
  .mcp-confirm-args pre {
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
  .mcp-confirm-args pre:focus-visible { outline: 1px solid var(--accent); }
  .mcp-confirm-remember { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .mcp-confirm-actions { display: flex; align-items: center; gap: 6px; }
  .mcp-confirm-actions button {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .mcp-confirm-actions .mcp-confirm-allow {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--bg);
  }
  .mcp-confirm-hint { margin-left: auto; color: var(--text-muted); font-size: 11px; }
</style>
