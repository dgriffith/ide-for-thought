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

  let pythonPathInput = $state('');
  /** What's saved to disk; used to detect dirty state. */
  let pythonPathSaved = $state('');
  let pythonProbe = $state<{ ok: boolean; path: string; version?: string; error?: string } | null>(null);
  let pythonProbing = $state(false);

  async function loadComputeSettings(): Promise<void> {
    try {
      const s = await api.compute.getPythonSettings();
      pythonPathInput = s.pythonPath;
      pythonPathSaved = s.pythonPath;
      // Probe whatever the resolver would currently pick so the status line
      // reflects the live state, not just the override.
      await refreshPythonProbe();
    } catch (e) {
      console.error('[settings] failed to load python settings:', e);
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
      await api.compute.setPythonSettings({ pythonPath: pythonPathInput.trim() });
      pythonPathSaved = pythonPathInput.trim();
      await refreshPythonProbe();
    } catch (e) {
      pythonProbe = { ok: false, path: pythonPathInput, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function restartPythonKernelFromSettings(): Promise<void> {
    try {
      await api.compute.restartPythonKernel();
    } catch (e) {
      console.error('[settings] failed to restart python kernel:', e);
    }
  }

  onMount(loadComputeSettings);
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

<style>
  /* Shared form vocabulary, scoped to this panel (the app's per-dialog
     convention — each component carries its own .field / .hint / button CSS). */
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text);
    font-size: 12px;
  }
  .field label { color: var(--text); }
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
</style>
