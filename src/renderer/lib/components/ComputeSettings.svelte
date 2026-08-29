<script lang="ts">
  /**
   * Compute settings panel (#374, extracted from SettingsDialog for #672).
   *
   * Self-contained: owns the per-machine Python interpreter override + the live
   * probe state, loads on mount, and drives everything through api.compute.*.
   * The dialog just mounts it for the "compute" tab.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import type { ComputeConsentSummary, PythonProbeResult } from '../../../shared/compute/types';
  import { logger } from '../../../shared/logger';
  import { getSettingsStore } from '../stores/settings.svelte';
  import Toggle from './ui/Toggle.svelte';

  const settings = getSettingsStore();

  /** Thoughtbases this machine has trusted for compute (#1413). */
  let consent = $state<ComputeConsentSummary[]>([]);

  async function loadConsent(): Promise<void> {
    try {
      consent = await api.compute.listConsent();
    } catch (e) {
      logger('settings').error('failed to load compute consent:', e);
    }
  }

  async function revokeConsent(rootPath: string): Promise<void> {
    await settings.revokeComputeConsent(rootPath);
    await loadConsent();
  }

  /** Last path segment for the prominent label; the full path sits muted below. */
  function baseName(p: string): string {
    const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/);
    return parts[parts.length - 1] || p;
  }

  let pythonPathInput = $state('');
  /** What's saved to disk; used to detect dirty state. */
  let pythonPathSaved = $state('');
  // The shared union (#1878), not a restated shape: `{#if pythonProbe.ok}` now
  // narrows, so the template reaches `version` and `error` on the arm that has
  // them rather than on an optional the compiler couldn't vouch for.
  let pythonProbe = $state<PythonProbeResult | null>(null);
  let pythonProbing = $state(false);
  /** Network egress toggle (#1413). Off by default; the kernel blocks non-local
   *  sockets unless this is on. Applied when the kernel next starts. */
  let allowNetwork = $state(false);

  async function loadComputeSettings(): Promise<void> {
    try {
      const s = await api.compute.getPythonSettings();
      pythonPathInput = s.pythonPath;
      pythonPathSaved = s.pythonPath;
      allowNetwork = s.allowNetwork;
      // Probe whatever the resolver would currently pick so the status line
      // reflects the live state, not just the override.
      await refreshPythonProbe();
    } catch (e) {
      logger('settings').error('failed to load python settings:', e);
    }
  }

  async function refreshPythonProbe(): Promise<void> {
    pythonProbing = true;
    try {
      // Empty `pythonPathInput` → probe the resolver's active pick (env var or
      // `python3`). Non-empty → probe the input directly so the status line
      // shows whether the candidate would work.
      pythonProbe = await api.compute.probePython(pythonPathInput.trim() || undefined);
    } catch (e) {
      pythonProbe = { ok: false, path: pythonPathInput, error: e instanceof Error ? e.message : String(e) };
    } finally {
      pythonProbing = false;
    }
  }

  async function browsePythonInterpreter(): Promise<void> {
    const picked = await api.compute.browsePython();
    if (!picked) return;
    pythonPathInput = picked;
    // Probe immediately so the user gets instant feedback on whether the
    // picked file is actually a runnable Python.
    await refreshPythonProbe();
  }

  async function savePythonPath(): Promise<void> {
    try {
      await settings.setPythonSettings({ pythonPath: pythonPathInput.trim(), allowNetwork });
      pythonPathSaved = pythonPathInput.trim();
      await refreshPythonProbe();
    } catch (e) {
      pythonProbe = { ok: false, path: pythonPathInput, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Persist the network toggle immediately (#1413). Takes effect when the
   *  kernel next starts — the hint tells the user to restart to apply now. */
  async function saveNetworkSetting(): Promise<void> {
    try {
      await settings.setPythonSettings({ pythonPath: pythonPathSaved, allowNetwork });
    } catch (e) {
      logger('settings').error('failed to save network setting:', e);
      // Revert the optimistic toggle so the UI reflects what's on disk.
      allowNetwork = !allowNetwork;
    }
  }

  async function restartPythonKernelFromSettings(): Promise<void> {
    try {
      await settings.restartPythonKernel();
    } catch (e) {
      logger('settings').error('failed to restart python kernel:', e);
    }
  }

  onMount(() => {
    void loadComputeSettings();
    void loadConsent();
  });
</script>

<div class="field">
  <label for="python-path">Python interpreter</label>
  <p class="hint">
    Path to the Python executable Minerva should use for cell
    execution. Leave empty to fall back to the
    <code>MINERVA_PYTHON</code> environment variable, then to
    <code>python3</code> on <code>$PATH</code>. Stored
    per-machine — different projects on this machine share the
    same interpreter.
  </p>
  <div class="path-row">
    <input
      id="python-path"
      type="text"
      bind:value={pythonPathInput}
      placeholder="/Users/you/.minerva-venv/bin/python"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
    />
    <button
      class="action-btn"
      onclick={() => { void browsePythonInterpreter(); }}
      disabled={pythonProbing}
    >
      Browse…
    </button>
    <button
      class="action-btn"
      onclick={() => { void refreshPythonProbe(); }}
      disabled={pythonProbing}
      title="Test the interpreter — runs `python --version`"
    >
      {pythonProbing ? 'Probing…' : 'Probe'}
    </button>
  </div>

  {#if pythonProbe}
    <div class="probe-result" class:probe-ok={pythonProbe.ok} class:probe-error={!pythonProbe.ok}>
      {#if pythonProbe.ok}
        <strong>{pythonProbe.version}</strong>
        <span class="probe-path">at <code>{pythonProbe.path}</code></span>
      {:else}
        <strong>Couldn't run interpreter:</strong>
        <span class="probe-path">{pythonProbe.error}</span>
      {/if}
    </div>
  {/if}

  <div class="action-row">
    <button
      class="action-btn primary"
      onclick={() => { void savePythonPath(); }}
      disabled={pythonProbing || pythonPathInput.trim() === pythonPathSaved}
    >
      Save
    </button>
    <button
      class="action-btn"
      onclick={() => { void restartPythonKernelFromSettings(); }}
      title="Apply the new interpreter to a fresh kernel — wipes namespace state"
    >
      Save &amp; Restart Kernel
    </button>
    {#if pythonPathSaved}
      <button
        class="link-btn"
        onclick={() => { pythonPathInput = ''; void savePythonPath(); }}
      >
        Clear override
      </button>
    {/if}
  </div>

  <p class="hint">
    Tip: a venv at <code>~/.minerva-venv/bin/python</code> with
    <code>pandas</code>, <code>matplotlib</code>, and
    <code>pillow</code> installed gives you the full rich-output
    pipeline. After changing the interpreter, click
    <em>Save &amp; Restart Kernel</em> so the next cell runs
    against the new env.
  </p>
</div>

<div class="field toggle-field">
  <label class="toggle-row">
    <Toggle bind:checked={allowNetwork} onchange={() => { void saveNetworkSetting(); }} />
    <span>Allow network access for Python cells</span>
  </label>
  <p class="hint">
    Off by default. The kernel blocks outbound connections
    (<code>requests</code>, <code>urllib</code>,
    <code>pandas.read_csv(url)</code>, raw sockets) to everything but
    <code>localhost</code>, so a cell can't quietly send your data
    elsewhere — the scariest thing an unreviewed cell could do. Turn this
    on only if you trust the code you run to reach the network. Takes
    effect when the kernel next starts; use
    <em>Save &amp; Restart Kernel</em> above to apply now.
  </p>
</div>

<div class="field trust-field">
  <div class="field-heading" id="trust-heading">Trusted thoughtbases</div>
  <p class="hint">
    Compute cells run with real access to your machine, so each cell is
    reviewed before its first run and the choice is remembered
    <strong>per-machine</strong> (it never travels with a shared
    thoughtbase). Revoke a thoughtbase here to make its cells prompt for
    review again.
  </p>

  {#if consent.length === 0}
    <p class="empty">No thoughtbases are trusted for compute yet.</p>
  {:else}
    <ul class="trust-list" aria-labelledby="trust-heading">
      {#each consent as entry (entry.rootPath)}
        <li class="trust-row">
          <div class="trust-id">
            <span class="trust-name">{baseName(entry.rootPath)}</span>
            <span class="trust-path" title={entry.rootPath}>{entry.rootPath}</span>
          </div>
          <span class="trust-badge" class:blanket={entry.blanket}>
            {#if entry.blanket}
              Trusts all compute
            {:else}
              {entry.cellCount} {entry.cellCount === 1 ? 'cell' : 'cells'}
            {/if}
          </span>
          <button class="action-btn" onclick={() => { void revokeConsent(entry.rootPath); }}>
            Revoke
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<div class="field audit-field">
  <div class="field-heading" id="audit-heading">Execution audit log</div>
  <p class="hint">
    Every compute cell that runs is recorded to a local log — when it ran,
    which thoughtbase and note, whether it came from the editor or a
    conversation (AI-authored), and its outcome. Stored on this machine
    only, so it can't be tampered with by a shared thoughtbase.
  </p>
  <button class="action-btn" onclick={() => { void api.compute.revealAuditLog(); }}>
    Reveal audit log
  </button>
</div>

<style>
  /* Shared form vocabulary, scoped to this panel (the app's per-dialog
     convention — each component carries its own .hint / button CSS). The
     base .field shape moved to global.css (#1910) — 13 of 19 occurrences
     were byte-identical to it. */
  .field label,
  .field .field-heading { color: var(--text); }
  .field input[type="text"] {
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
  }
  .field input[type="text"]:focus {
    outline: none;
    border-color: var(--accent);
  }
  .hint {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
  .hint code {
    background: var(--bg-button);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
  }
  .action-btn {
    align-self: flex-start;
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .action-btn:hover:not(:disabled) { background: var(--bg-button-hover); }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .action-btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
    font-weight: 500;
  }
  .action-btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .link-btn {
    align-self: flex-start;
    margin-top: 4px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: underline;
    cursor: pointer;
  }
  .link-btn:hover { color: var(--text); }

  /* Compute-specific. */
  .path-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 6px 0;
  }
  .path-row input[type="text"] {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
  }
  .probe-result {
    padding: 6px 10px;
    border-left: 3px solid var(--border);
    background: var(--bg-button);
    font-size: 12px;
    margin: 6px 0;
    border-radius: 0 3px 3px 0;
  }
  .probe-result.probe-ok { border-left-color: var(--accent); }
  .probe-result.probe-error { border-left-color: var(--accent); }
  .probe-result strong { display: block; margin-bottom: 2px; }
  .probe-result .probe-path {
    color: var(--text-muted);
    font-size: 11px;
  }
  .probe-result code {
    font-size: 11px;
    background: var(--bg);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .action-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 8px 0;
  }

  /* Network toggle (#1413). */
  .toggle-field {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  /* Trusted-thoughtbases list + audit section (#1413). */
  .trust-field,
  .audit-field {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .empty {
    margin: 8px 0 0 0;
    color: var(--text-muted);
    font-size: 12px;
    font-style: italic;
  }
  .trust-list {
    list-style: none;
    margin: 8px 0 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .trust-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    background: var(--bg-button);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .trust-id {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .trust-name {
    font-size: 12px;
    color: var(--text);
    font-weight: 500;
  }
  .trust-path {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--font-mono, ui-monospace, monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .trust-badge {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-muted);
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .trust-badge.blanket {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
