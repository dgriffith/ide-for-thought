<script lang="ts">
  /**
   * About Minerva (#803). Themed modal launched from the app menu's About item
   * (App.svelte wires `api.menu.onAbout`). Shows version + build provenance,
   * runtime versions, and acknowledgments — including the required attribution
   * for the Future Tokens thinking skills (Creative Commons).
   */
  import { api } from '../ipc/client';
  import type { AppInfo } from '../ipc/client';
  // Vite resolves the bundled icon to a URL (same `?url` pattern as the OCR
  // trained-data asset). SVG keeps it crisp at any DPI.
  import iconUrl from '../../assets/minerva-icon.svg?url';
  import Eyebrow from './ui/Eyebrow.svelte';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  const REPO_URL = 'https://github.com/dgriffith/ide-for-thought';
  // The template chooser, matching Help → Report an Issue (see main/menu.ts).
  const ISSUES_URL = 'https://github.com/dgriffith/ide-for-thought/issues/new/choose';
  const FUTURE_TOKENS_URL = 'https://github.com/jordanrubin/FUTURE_TOKENS';

  let info = $state<AppInfo | null>(null);
  $effect(() => { void api.app.getInfo().then((i) => { info = i; }); });

  function open(url: string) {
    void api.shell.openExternal(url);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
    <header class="card-header">
      <img class="app-icon" src={iconUrl} alt="" />
      <div class="brand">
        <div class="eyebrow-row"><Eyebrow>About</Eyebrow></div>
        <h2 class="title" id="about-title">Minerva</h2>
        <p class="tagline">Thoughts worth keeping.</p>
      </div>
    </header>

    <div class="body">
      <dl class="facts">
        <dt>Version</dt>
        <dd>{info ? `${info.version} · ${info.commit} · ${info.buildDate}` : '…'}</dd>
        <dt>Runtime</dt>
        <dd>{info ? `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}` : '…'}</dd>
      </dl>

      <div class="links">
        <button class="link" onclick={() => open(REPO_URL)}>Source on GitHub</button>
        <span class="dot">·</span>
        <button class="link" onclick={() => open(ISSUES_URL)}>Report an issue</button>
      </div>

      <section class="ack">
        <h3>Acknowledgments</h3>
        <p>
          Many of Minerva's thinking skills are adapted from
          <button class="link" onclick={() => open(FUTURE_TOKENS_URL)}>Future Tokens</button>
          by Jordan Rubin, used with thanks under its Creative Commons license.
        </p>
      </section>
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · close</span>
      <button class="btn primary" onclick={onClose}>OK</button>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: var(--scrim-bg);
    backdrop-filter: var(--scrim-blur);
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
    width: 440px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
  }

  .card-header {
    padding: 20px 24px 0;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .app-icon {
    width: 64px;
    height: 64px;
    flex-shrink: 0;
    border-radius: 14px;
  }
  .brand {
    min-width: 0;
  }
  .eyebrow-row {
    margin-bottom: 6px;
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--text);
  }
  .tagline {
    margin: 6px 0 0;
    font-family: var(--font-display);
    font-size: 13.5px;
    font-style: italic;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .body {
    padding: 16px 24px 4px;
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 14px;
    margin: 0 0 14px;
    font-size: 12px;
  }
  .facts dt {
    color: var(--text-muted);
  }
  .facts dd {
    margin: 0;
    font-family: var(--font-mono);
    color: var(--text);
  }

  .links {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    margin-bottom: 14px;
  }
  .dot { color: var(--text-faint); }

  .ack {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .ack h3 {
    margin: 0 0 6px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .ack p {
    margin: 0;
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-muted);
  }

  /* Inline link-styled buttons (no native anchors — navigation goes through
     the sandboxed shell.openExternal IPC, never the renderer). */
  .link {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:hover { opacity: 0.85; }

  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
    margin-top: 12px;
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
