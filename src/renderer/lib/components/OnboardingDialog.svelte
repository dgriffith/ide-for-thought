<script lang="ts">
  /**
   * First-run onboarding modal shown when an empty thoughtbase is opened.
   * Mounted by App.svelte after `onProjectOpened` if the directory has
   * zero notes AND `getOnboardingDismissed()` is false. The user picks a
   * subject + a few framing answers; on confirm the parent kicks off a
   * conversation pre-loaded with a system prompt that instructs the
   * agent to draft an index + linked child notes via `propose_notes`.
   *
   * Layout follows IMPLEMENTATION.md §11: two columns — a 280px brand
   * panel on the left (mark + wordmark + tagline + Hegel epigraph) and
   * the form on the right (eyebrow + display H1 + 4 fields + footer).
   *
   * "Don't show again" is per-thoughtbase via `notebase.setOnboardingDismissed`.
   */
  import Icon from './Icon.svelte';
  import SegmentedControl from './ui/SegmentedControl.svelte';

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

  const EXPERTISE_OPTIONS = [
    { value: 'beginner', label: 'new to it' },
    { value: 'familiar', label: 'familiar' },
    { value: 'expert',   label: 'expert' },
  ] as const;

  const DEPTH_OPTIONS = [
    { value: 'quick',    label: 'quick',    sub: '3–5 notes' },
    { value: 'moderate', label: 'moderate', sub: '8–12 notes' },
    { value: 'deep',     label: 'deep',     sub: '15–25 notes' },
  ] as const;

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
    <!-- Left brand panel -->
    <aside class="brand-panel">
      <div class="brand-rule" aria-hidden="true"></div>
      <div class="brand-top">
        <Icon name="minervaMark" size={64} color="var(--accent)" />
        <div class="wordmark">Minerva</div>
        <div class="tagline">Software for superhumans</div>
      </div>
      <blockquote class="epigraph">
        <p>“The owl of Minerva spreads her wings only with the falling of the dusk.”</p>
        <cite>— Hegel</cite>
      </blockquote>
    </aside>

    <!-- Right form -->
    <div class="form-panel">
      <header class="form-header">
        <div class="eyebrow">New thoughtbase · step 1 of 1</div>
        <h1 id="onboarding-title" class="title">What would you like to think about?</h1>
        <p class="lede">
          I'll draft a starter set of linked notes — an index plus a handful of
          children — and you can approve, edit, or discard the whole thing
          with one keystroke.
        </p>
      </header>

      <div class="fields">
        <div class="field">
          <label class="label" for="onb-subject">Subject</label>
          <input
            id="onb-subject"
            bind:this={subjectInput}
            bind:value={subject}
            type="text"
            class="text-input"
            placeholder="e.g. the epistemology of dialogue"
            onkeydown={(e) => { if (e.key === 'Enter' && canSubmit) handleAccept(); }}
          />
        </div>

        <div class="field field-inline">
          <span class="label">Reader</span>
          <SegmentedControl
            bind:value={expertise as unknown as string}
            options={EXPERTISE_OPTIONS}
            aria-label="Reader expertise"
          />
        </div>

        <div class="field field-inline">
          <span class="label">Depth</span>
          <SegmentedControl
            bind:value={depth as unknown as string}
            options={DEPTH_OPTIONS}
            aria-label="Overview depth"
          />
        </div>

        <div class="field">
          <label class="label" for="onb-use">
            For
            <span class="optional">· optional</span>
          </label>
          <input
            id="onb-use"
            bind:value={use}
            type="text"
            class="text-input"
            placeholder="e.g. a graduate seminar I'm preparing"
          />
        </div>
      </div>

      <div class="spacer"></div>

      <footer class="footer">
        <button class="btn primary" disabled={!canSubmit} onclick={handleAccept}>
          <Icon name="sparkle" size={12} />
          Draft my thoughtbase
        </button>
        <button class="btn secondary" onclick={handleDecline}>I'll start from scratch</button>
        <span class="spacer-inline"></span>
        <label class="dont-ask">
          <input type="checkbox" bind:checked={dontAskAgain} />
          Don't ask again
        </label>
      </footer>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(20, 14, 6, 0.55);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .dialog {
    display: flex;
    align-items: stretch;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    width: 820px;
    max-width: 100%;
    min-height: 520px;
    max-height: calc(100vh - 64px);
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-sans);
  }

  /* ── Left brand panel ─────────────────────────────────────────── */
  .brand-panel {
    width: 280px;
    padding: 36px;
    background: var(--bg-elev);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }
  /* Subtle paper-ruling */
  .brand-rule {
    position: absolute;
    inset: 0;
    opacity: 0.05;
    pointer-events: none;
    background-image: repeating-linear-gradient(
      0deg,
      transparent 0 30px,
      var(--text) 30px 30.5px
    );
  }
  .brand-top {
    position: relative;
  }
  .wordmark {
    font-family: var(--font-display);
    font-size: 36px;
    font-weight: 500;
    letter-spacing: -0.02em;
    margin-top: 16px;
    line-height: 1;
    color: var(--text);
  }
  .tagline {
    font-family: var(--font-display);
    font-style: italic;
    color: var(--text-muted);
    font-size: 13px;
    margin-top: 4px;
  }
  .epigraph {
    position: relative;
    margin: 0;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 15px;
    line-height: 1.55;
    color: var(--text-muted);
  }
  .epigraph p {
    margin: 0;
  }
  .epigraph cite {
    display: block;
    margin-top: 8px;
    font-size: 11px;
    font-family: var(--font-mono);
    font-style: normal;
    color: var(--text-faint);
  }

  /* ── Right form ───────────────────────────────────────────────── */
  .form-panel {
    flex: 1;
    padding: 44px 48px;
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-width: 0;
    overflow: auto;
  }
  .form-header .eyebrow {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 500;
    letter-spacing: -0.015em;
    line-height: 1.1;
    color: var(--text);
  }
  .lede {
    margin: 10px 0 0;
    font-size: 13.5px;
    color: var(--text-muted);
    line-height: 1.55;
    max-width: 460px;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 460px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .field-inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }
  .label {
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--font-sans);
  }
  .optional {
    color: var(--text-faint);
    margin-left: 4px;
  }
  .text-input {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-family: var(--font-sans);
    font-size: 13px;
    outline: none;
  }
  .text-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent);
  }

  .spacer {
    flex: 1;
  }
  .spacer-inline {
    flex: 1;
  }

  /* ── Footer ──────────────────────────────────────────────────── */
  .footer {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .btn {
    padding: 9px 18px;
    border: none;
    border-radius: 7px;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }
  .btn.primary:hover:not(:disabled) {
    opacity: 0.92;
  }
  .btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.secondary {
    background: transparent;
    color: var(--text-muted);
    padding: 9px 12px;
  }
  .btn.secondary:hover {
    color: var(--text);
  }
  .dont-ask {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--text-faint);
    cursor: pointer;
  }
  .dont-ask input {
    accent-color: var(--accent);
    cursor: pointer;
  }
</style>
