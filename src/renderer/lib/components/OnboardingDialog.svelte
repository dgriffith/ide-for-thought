<script lang="ts">
  /**
   * First-run onboarding modal shown when an empty thoughtbase is opened.
   * Mounted by App.svelte after `onProjectOpened` if the directory has
   * zero notes AND `getOnboardingDismissed()` is false. The user picks a
   * subject + a few framing answers; on confirm the parent kicks off a
   * conversation pre-loaded with a system prompt that instructs the
   * agent to draft an index + linked child notes via `propose_notes`.
   *
   * The dialog is intentionally a single page (not a wizard) — four
   * fields fits comfortably and a multi-step flow felt heavyweight for
   * something a user might dismiss on sight. "Don't show again" is a
   * per-thoughtbase opt-out wired through `notebase.setOnboardingDismissed`.
   */
  export interface OnboardingAnswers {
    subject: string;
    expertise: 'beginner' | 'familiar' | 'expert';
    use: string;
    depth: 'quick' | 'moderate' | 'deep';
  }

  interface Props {
    onAccept: (answers: OnboardingAnswers, dontAskAgain: boolean) => void;
    onDecline: (dontAskAgain: boolean) => void;
  }

  let { onAccept, onDecline }: Props = $props();

  let subject = $state('');
  let expertise = $state<OnboardingAnswers['expertise']>('familiar');
  let use = $state('');
  let depth = $state<OnboardingAnswers['depth']>('moderate');
  let dontAskAgain = $state(false);
  let subjectInput = $state<HTMLInputElement>();

  $effect(() => { subjectInput?.focus(); });

  const canSubmit = $derived(subject.trim().length > 0);

  function handleAccept() {
    if (!canSubmit) return;
    onAccept(
      {
        subject: subject.trim(),
        expertise,
        use: use.trim(),
        depth,
      },
      dontAskAgain,
    );
  }

  function handleDecline() {
    onDecline(dontAskAgain);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleDecline();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) handleDecline(); }}>
  <div class="dialog" role="dialog" aria-labelledby="onboarding-title">
    <h2 id="onboarding-title" class="title">Welcome to your new thoughtbase</h2>
    <p class="lede">
      Want a head start? Tell me what you’re curious about and I’ll draft an
      index plus a set of linked notes you can edit, branch from, or throw out.
    </p>

    <label class="field">
      <span class="label">What would you like an overview of?</span>
      <input
        bind:this={subjectInput}
        bind:value={subject}
        type="text"
        class="text-input"
        placeholder="e.g. game theory, the Reformation, gene regulatory networks…"
        onkeydown={(e) => { if (e.key === 'Enter' && canSubmit) handleAccept(); }}
      />
    </label>

    <fieldset class="field">
      <legend class="label">How familiar are you with this topic?</legend>
      <div class="radio-row">
        <label class="radio">
          <input type="radio" name="expertise" value="beginner" bind:group={expertise} />
          <span>New to it</span>
        </label>
        <label class="radio">
          <input type="radio" name="expertise" value="familiar" bind:group={expertise} />
          <span>Some familiarity</span>
        </label>
        <label class="radio">
          <input type="radio" name="expertise" value="expert" bind:group={expertise} />
          <span>Already deep</span>
        </label>
      </div>
    </fieldset>

    <label class="field">
      <span class="label">How do you plan to use these notes? <span class="optional">(optional)</span></span>
      <input
        bind:value={use}
        type="text"
        class="text-input"
        placeholder="study, writing, research, teaching, exploration…"
      />
    </label>

    <fieldset class="field">
      <legend class="label">How deep should the overview go?</legend>
      <div class="radio-row">
        <label class="radio">
          <input type="radio" name="depth" value="quick" bind:group={depth} />
          <span>Quick orientation <em>(3–5 notes)</em></span>
        </label>
        <label class="radio">
          <input type="radio" name="depth" value="moderate" bind:group={depth} />
          <span>Moderate <em>(8–12)</em></span>
        </label>
        <label class="radio">
          <input type="radio" name="depth" value="deep" bind:group={depth} />
          <span>Deep dive <em>(15–25)</em></span>
        </label>
      </div>
    </fieldset>

    <div class="footer">
      <label class="dont-ask">
        <input type="checkbox" bind:checked={dontAskAgain} />
        Don’t show this for this thoughtbase
      </label>
      <div class="actions">
        <button class="btn secondary" onclick={handleDecline}>Not now</button>
        <button class="btn primary" disabled={!canSubmit} onclick={handleAccept}>Get started</button>
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dialog {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px 22px;
    min-width: 460px;
    max-width: 540px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }
  .lede {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-muted);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: none;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  .label {
    font-size: 12px;
    color: var(--text);
    font-weight: 500;
  }
  .optional {
    color: var(--text-muted);
    font-weight: 400;
  }
  .text-input {
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
  }
  .text-input:focus { outline: none; border-color: var(--accent); }
  .radio-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .radio {
    display: flex;
    align-items: baseline;
    gap: 8px;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .radio:hover { background: var(--bg-button); }
  .radio input { cursor: pointer; }
  .radio em {
    color: var(--text-muted);
    font-style: normal;
    font-size: 12px;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 4px;
  }
  .dont-ask {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
  }
  .dont-ask input { cursor: pointer; }
  .actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }
  .btn {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .secondary {
    background: var(--bg-button);
    color: var(--text);
  }
  .secondary:hover { background: var(--bg-button-hover); }
  .primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .primary:hover:not(:disabled) { opacity: 0.9; }
  .primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
