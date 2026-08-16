<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { getPublishStore } from '../stores/publish.svelte';
  import type { PublishTarget, PublishGitResponse } from '../ipc/client';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  const publish = getPublishStore();

  let targets = $state<PublishTarget[]>([]);
  // Project-scoped exporters (directory-tree output is what makes sense to
  // push); defaults to static-site when present.
  let exporters = $state<{ id: string; label: string }[]>([]);
  let loaded = $state(false);
  let showForm = $state(false);
  let busyId = $state<string | null>(null);
  /** Whether the in-flight run is a preview. The button labels describe the
   *  OPERATION, not the target kind, now that both kinds can be previewed —
   *  otherwise previewing an S3 target reads "Uploading…", which is a lie. */
  let busyDryRun = $state(false);
  // Last publish/preview outcome, shown under its target.
  let outcome = $state<{ targetId: string; dryRun: boolean; res: PublishGitResponse } | null>(null);

  // ── Add-target form ─────────────────────────────────────────────────────
  let fKind = $state<'git' | 's3'>('git');
  let fLabel = $state('');
  let fExporter = $state('static-site');
  let fSubdir = $state('.');
  // git
  let fRemote = $state('');
  let fBranch = $state('gh-pages');
  let fTemplate = $state('Publish {{date}} from Minerva');
  let fToken = $state('');
  // s3
  let fBucket = $state('');
  let fEndpoint = $state('');
  let fRegion = $state('');
  let fAccessKeyId = $state('');
  let fSecret = $state('');

  // S3 "test connection" state (#1444).
  let s3Checking = $state(false);
  let s3CheckResult = $state<import('../../../shared/tools/types').ConnectionCheckResult | null>(null);
  // Any edit to the S3 credentials invalidates a prior check result.
  $effect(() => { void fBucket; void fEndpoint; void fRegion; void fAccessKeyId; void fSecret; s3CheckResult = null; });
  const canCheckS3 = $derived(fBucket.trim() !== '');

  // GitHub "test connection" (#1508). A blank token tests the gh CLI / env fallback.
  let gitChecking = $state(false);
  let gitCheckResult = $state<import('../../../shared/tools/types').ConnectionCheckResult | null>(null);
  $effect(() => { void fToken; gitCheckResult = null; });

  async function runGitHubCheck(): Promise<void> {
    if (gitChecking) return;
    gitChecking = true;
    gitCheckResult = null;
    try {
      gitCheckResult = await api.publish.checkGitHub({ ...(fToken.trim() ? { token: fToken.trim() } : {}) });
    } catch (e) {
      gitCheckResult = { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      gitChecking = false;
    }
  }

  async function runS3Check(): Promise<void> {
    if (s3Checking || !canCheckS3) return;
    s3Checking = true;
    s3CheckResult = null;
    try {
      s3CheckResult = await api.publish.checkS3({
        bucket: fBucket.trim(),
        ...(fEndpoint.trim() ? { endpoint: fEndpoint.trim() } : {}),
        ...(fRegion.trim() ? { region: fRegion.trim() } : {}),
        ...(fAccessKeyId.trim() ? { accessKeyId: fAccessKeyId.trim() } : {}),
        ...(fSecret ? { secretAccessKey: fSecret } : {}),
      });
    } catch (e) {
      s3CheckResult = { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      s3Checking = false;
    }
  }

  onMount(async () => {
    await refresh();
    const all = await api.publish.listExporters();
    exporters = all
      .filter((e) => (e.acceptedKinds ?? []).includes('project'))
      .map((e) => ({ id: e.id, label: e.label }));
    if (!exporters.some((e) => e.id === 'static-site') && exporters[0]) {
      fExporter = exporters[0].id;
    }
    loaded = true;
  });

  async function refresh(): Promise<void> {
    targets = await api.publish.listTargets();
  }

  function slug(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'target';
  }

  function uniqueId(base: string): string {
    let id = base;
    let n = 2;
    const taken = new Set(targets.map((t) => t.id));
    while (taken.has(id)) id = `${base}-${n++}`;
    return id;
  }

  const canSave = $derived(
    fLabel.trim() !== '' &&
      (fKind === 's3'
        ? fBucket.trim() !== ''
        : fRemote.trim() !== '' && fBranch.trim() !== ''),
  );

  async function saveTarget(): Promise<void> {
    if (!canSave) return;
    const common = { id: uniqueId(slug(fLabel)), label: fLabel.trim(), exporter: fExporter, subdir: fSubdir.trim() || '.' };
    const target: PublishTarget = fKind === 's3'
      ? {
          ...common,
          kind: 's3',
          bucket: fBucket.trim(),
          ...(fEndpoint.trim() ? { endpoint: fEndpoint.trim() } : {}),
          ...(fRegion.trim() ? { region: fRegion.trim() } : {}),
          ...(fAccessKeyId.trim() ? { accessKeyId: fAccessKeyId.trim() } : {}),
          // Write-only + tri-state: send only when the user typed one.
          ...(fSecret ? { secretAccessKey: fSecret } : {}),
        }
      : {
          ...common,
          gitRemote: fRemote.trim(),
          gitBranch: fBranch.trim(),
          commitMessageTemplate: fTemplate.trim() || 'Publish {{date}} from Minerva',
          // Write-only + tri-state: send only when the user typed one.
          ...(fToken ? { githubToken: fToken } : {}),
        };
    targets = await publish.upsertTarget(target);
    showForm = false;
    fLabel = '';
    fRemote = '';
    fToken = '';
    fBucket = '';
    fEndpoint = '';
    fRegion = '';
    fAccessKeyId = '';
    fSecret = '';
    s3CheckResult = null;
    gitCheckResult = null;
  }

  async function removeTarget(id: string): Promise<void> {
    targets = await publish.removeTarget(id);
    if (outcome?.targetId === id) outcome = null;
  }

  async function run(target: PublishTarget, dryRun: boolean): Promise<void> {
    busyId = target.id;
    busyDryRun = dryRun;
    outcome = null;
    try {
      const res = await publish.toGit(target.id, { dryRun });
      outcome = { targetId: target.id, dryRun, res };
    } finally {
      busyId = null;
    }
  }

  /**
   * Answer the "repository doesn't exist" prompt: create it, then publish for
   * real. Reached only from the inline prompt, so the user has just chosen the
   * visibility — nothing here happens on its own.
   */
  async function createRepoAndPublish(target: PublishTarget, isPrivate: boolean): Promise<void> {
    busyId = target.id;
    outcome = null;
    try {
      const res = await publish.toGit(target.id, { createRepo: { private: isPrivate } });
      outcome = { targetId: target.id, dryRun: false, res };
    } finally {
      busyId = null;
    }
  }

  function counts(res: PublishGitResponse): string {
    if (!res.ok) return '';
    const c = res.result.changes;
    const a = c.filter((x) => x.status === 'added').length;
    const m = c.filter((x) => x.status === 'modified').length;
    const d = c.filter((x) => x.status === 'deleted').length;
    return `${a} added · ${m} modified · ${d} deleted`;
  }

  function copyError(msg: string): void {
    void navigator.clipboard.writeText(msg);
  }

  function onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose();
  }

  // Keyboard parity for the backdrop dismiss (matches ConfirmDialog/PromptDialog).
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="publish-backdrop" onmousedown={onBackdrop} onkeydown={onKeydown}>
  <div class="publish-dialog" role="dialog" aria-labelledby="publish-title">
    <h2 id="publish-title">Publish to Web</h2>
    <p class="sub">Push an export to a git remote (e.g. a static site to GitHub Pages) or upload it
      to an S3 / S3-compatible bucket (Amazon S3, Cloudflare R2, Backblaze B2, MinIO, …).</p>

    {#if !loaded}
      <p class="muted">Loading…</p>
    {:else}
      {#if targets.length === 0 && !showForm}
        <p class="muted">No publish targets yet.</p>
      {/if}

      <ul class="targets">
        {#each targets as t (t.id)}
          <li class="target">
            <div class="target-head">
              <div class="target-meta">
                <div class="target-label">{t.label}</div>
                {#if t.kind === 's3'}
                  <div class="target-detail">{t.exporter} → s3://{t.bucket}{t.subdir && t.subdir !== '.' ? `/${t.subdir}` : ''}</div>
                {:else}
                  <div class="target-detail">{t.exporter} → {t.gitRemote} <span class="branch">({t.gitBranch})</span></div>
                {/if}
              </div>
              <div class="target-actions">
                <!-- Both kinds preview: publishToS3 lists every add / change /
                     delete and returns before uploading, exactly as the git
                     path does before pushing. -->
                <button onclick={() => run(t, true)} disabled={busyId === t.id}>
                  {busyId === t.id && busyDryRun ? 'Working…' : 'Preview'}
                </button>
                <button class="primary" onclick={() => run(t, false)} disabled={busyId === t.id}>
                  {busyId === t.id && !busyDryRun && t.kind === 's3' ? 'Uploading…' : 'Publish'}
                </button>
                <button class="ghost" onclick={() => removeTarget(t.id)} disabled={busyId === t.id} title="Remove target">✕</button>
              </div>
            </div>

            {#if outcome && outcome.targetId === t.id}
              {@const res = outcome.res}
              <div class="outcome" class:error={!res.ok}>
                {#if !res.ok}
                  <div class="outcome-head">Publish failed</div>
                  <pre class="raw">{res.error}</pre>
                  <button class="ghost small" onclick={() => copyError(res.error)}>Copy error</button>
                {:else if res.result.repoMissing}
                  <div class="outcome-head">Repository not found</div>
                  <div class="muted">
                    GitHub has no <code>{res.result.repoMissing.owner}/{res.result.repoMissing.repo}</code>
                    — or your token can't see it. Nothing was published.
                  </div>
                  <div class="repo-create">
                    <button onclick={() => void createRepoAndPublish(t, false)} disabled={busyId === t.id}>
                      Create public repository &amp; publish
                    </button>
                    <button class="ghost" onclick={() => void createRepoAndPublish(t, true)} disabled={busyId === t.id}>
                      Create private &amp; publish
                    </button>
                  </div>
                  <div class="muted">
                    GitHub Pages serves a private repository only on a paid plan. The branch
                    <code>{res.result.branch}</code> is created by the first push either way.
                  </div>
                {:else if outcome.dryRun}
                  <div class="outcome-head">Preview — {counts(res)}</div>
                  {#if res.result.changes.length === 0}
                    <div class="muted">Nothing has changed since the last publish.</div>
                  {:else}
                    <ul class="changes">
                      {#each res.result.changes.slice(0, 12) as ch (ch.path)}
                        <li><span class="st st-{ch.status}">{ch.status[0]!.toUpperCase()}</span> {ch.path}</li>
                      {/each}
                    </ul>
                    {#if res.result.changes.length > 12}
                      <div class="muted">…and {res.result.changes.length - 12} more</div>
                    {/if}
                    {#if res.result.branchCreated}<div class="muted">Branch <code>{res.result.branch}</code> will be created.</div>{/if}
                  {/if}
                {:else if res.result.committed}
                  <div class="outcome-head">Published — {counts(res)}</div>
                  {#if t.kind === 's3'}
                    <div class="muted">Uploaded to <code>s3://{t.bucket}{t.subdir && t.subdir !== '.' ? `/${t.subdir}` : ''}</code>.</div>
                  {:else}
                    <div class="muted">Pushed to <code>{res.result.branch}</code>{res.result.branchCreated ? ' (created)' : ''} · {res.result.sha?.slice(0, 7)} · {res.result.commitMessage}</div>
                    {#if res.result.repoCreated}
                      <div class="muted">Repository created.</div>
                    {/if}
                    {#if res.result.pagesUrl}
                      {@const pagesUrl = res.result.pagesUrl}
                      <div class="muted">
                        Pages: <button class="link" onclick={() => void api.shell.openExternal(pagesUrl)}>{pagesUrl}</button>
                        <span class="muted"> — the first build can take a minute.</span>
                      </div>
                    {:else if res.result.pagesNote}
                      <div class="muted">{res.result.pagesNote}</div>
                    {/if}
                  {/if}
                {:else}
                  <div class="outcome-head">Up to date</div>
                  <div class="muted">Nothing has changed since the last publish.</div>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#if showForm}
        <div class="form">
          <div class="kind-switch" role="radiogroup" aria-label="Transport">
            <button class:selected={fKind === 'git'} role="radio" aria-checked={fKind === 'git'} onclick={() => { fKind = 'git'; }}>Git remote</button>
            <button class:selected={fKind === 's3'} role="radio" aria-checked={fKind === 's3'} onclick={() => { fKind = 's3'; }}>S3 bucket</button>
          </div>

          <label>Label<input bind:value={fLabel} placeholder="My Garden" /></label>

          {#if fKind === 's3'}
            <label>Bucket<input bind:value={fBucket} placeholder="my-site-bucket" /></label>
            <div class="row">
              <label>Endpoint (S3-compatible; blank for AWS)<input bind:value={fEndpoint} placeholder="https://<account>.r2.cloudflarestorage.com" /></label>
              <label>Region<input bind:value={fRegion} placeholder="auto" /></label>
            </div>
            <label>Key prefix<input bind:value={fSubdir} placeholder="." /></label>
            <div class="row">
              <label>Access key ID<input bind:value={fAccessKeyId} autocomplete="off" spellcheck="false" /></label>
              <label>Secret access key<input type="password" bind:value={fSecret} autocomplete="off" spellcheck="false"
                oncopy={(e) => e.preventDefault()} oncut={(e) => e.preventDefault()} placeholder="stored encrypted" /></label>
            </div>
            <p class="muted">Leave the keys blank to use the AWS default credential chain (<code>~/.aws</code>, env vars). Preview isn't available for S3 yet — Publish uploads changed files and removes ones no longer exported.</p>
            <div class="check-conn">
              <button onclick={runS3Check} disabled={!canCheckS3 || s3Checking}>{s3Checking ? 'Checking…' : 'Test connection'}</button>
              {#if s3CheckResult}
                <span class="check-result" class:ok={s3CheckResult.ok} class:bad={!s3CheckResult.ok}>
                  {#if s3CheckResult.ok}✓ Reached the bucket.{:else}✗ {s3CheckResult.error}{/if}
                </span>
              {/if}
            </div>
          {:else}
            <label>Remote URL<input bind:value={fRemote} placeholder="git@github.com:you/garden.git" /></label>
            <div class="row">
              <label>Branch<input bind:value={fBranch} /></label>
              <label>Subdirectory<input bind:value={fSubdir} /></label>
            </div>
            <label>Commit message<input bind:value={fTemplate} /></label>
            <label>GitHub token (optional)<input type="password" bind:value={fToken} autocomplete="off" spellcheck="false"
              oncopy={(e) => e.preventDefault()} oncut={(e) => e.preventDefault()} placeholder="stored encrypted" /></label>
            <p class="muted">Leave blank to use your GitHub CLI login (<code>gh</code>) or a <code>GH_TOKEN</code> environment variable.</p>
            <div class="check-conn">
              <button onclick={runGitHubCheck} disabled={gitChecking}>{gitChecking ? 'Checking…' : 'Test connection'}</button>
              {#if gitCheckResult}
                <span class="check-result" class:ok={gitCheckResult.ok} class:bad={!gitCheckResult.ok}>
                  {#if gitCheckResult.ok}✓ GitHub accepted the token.{:else}✗ {gitCheckResult.error}{/if}
                </span>
              {/if}
            </div>
          {/if}

          <label>Exporter
            <select bind:value={fExporter}>
              {#each exporters as e (e.id)}<option value={e.id}>{e.label}</option>{/each}
            </select>
          </label>
          <div class="form-actions">
            <button class="ghost" onclick={() => { showForm = false; }}>Cancel</button>
            <button class="primary" onclick={saveTarget} disabled={!canSave}>Save target</button>
          </div>
        </div>
      {/if}
    {/if}

    <div class="footer">
      {#if loaded && !showForm}
        <button onclick={() => { showForm = true; }}>Add target…</button>
      {/if}
      <button class="ghost" onclick={onClose}>Close</button>
    </div>
  </div>
</div>

<style>
  .publish-backdrop {
    position: fixed; inset: 0; z-index: var(--z-modal);
    background: var(--scrim-bg); backdrop-filter: var(--scrim-blur);
    display: flex; align-items: center; justify-content: center; padding: 32px;
  }
  .publish-dialog {
    background: var(--bg-elev); color: var(--text);
    border: 1px solid var(--border-strong); border-radius: 12px;
    padding: 20px 24px; width: 640px; max-width: 100%; max-height: calc(100vh - 64px);
    display: flex; flex-direction: column; overflow-y: auto;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
  }
  h2 { margin: 0 0 4px; font-weight: 500; }
  .sub { color: var(--text-muted); font-size: 0.85rem; margin: 0 0 16px; }
  .muted { color: var(--text-muted); font-size: 0.85rem; }
  code { background: var(--bg-inset, var(--bg)); padding: 0 4px; border-radius: 4px; }

  .targets { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .target { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
  .target-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .target-label { font-weight: 600; }
  .target-detail { color: var(--text-muted); font-size: 0.82rem; word-break: break-all; }
  .branch { color: var(--accent, #4a9); }
  .target-actions { display: flex; gap: 6px; flex-shrink: 0; }

  button {
    background: var(--bg-button); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 4px 12px; font-size: 0.85rem; cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--bg-button-hover); }
  button:disabled { opacity: 0.5; cursor: default; }
  button.primary { background: var(--accent); color: var(--accent-ink, #1a1a1a); border-color: transparent; }
  button.ghost { background: none; }
  button.small { padding: 2px 8px; font-size: 0.78rem; }

  .repo-create { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
  button.link {
    background: none; border: none; padding: 0; color: var(--accent);
    text-decoration: underline; font-size: inherit;
  }

  .outcome { margin-top: 10px; padding: 10px 12px; border-radius: 6px; background: var(--bg-inset, var(--bg)); font-size: 0.84rem; }
  .outcome.error { border: 1px solid var(--accent, #c66); }
  .outcome-head { font-weight: 600; margin-bottom: 6px; }
  .changes { list-style: none; padding: 0; margin: 6px 0; display: flex; flex-direction: column; gap: 2px; font-family: var(--font-mono, monospace); font-size: 0.8rem; }
  .st { display: inline-block; width: 1.2em; text-align: center; font-weight: 700; }
  .st-added { color: #6a9; }
  .st-modified { color: #ca6; }
  .st-deleted { color: #c66; }
  .raw { white-space: pre-wrap; word-break: break-word; background: var(--bg); padding: 8px; border-radius: 4px; font-size: 0.78rem; margin: 4px 0; }

  .form { border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
  .form label { display: flex; flex-direction: column; gap: 4px; font-size: 0.82rem; color: var(--text-muted); }
  .form .row { display: flex; gap: 10px; }
  .form .row label { flex: 1; }
  .form input, .form select { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 0.88rem; }
  .form-actions { display: flex; justify-content: flex-end; gap: 8px; }

  .kind-switch { display: flex; gap: 6px; }
  .kind-switch button { flex: 1; }
  .kind-switch button.selected { background: var(--accent); color: var(--accent-ink, #1a1a1a); border-color: transparent; }
  .check-conn { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .check-result { font-size: 0.82rem; }
  .check-result.ok { color: var(--sage, #6a9); }
  .check-result.bad { color: var(--rust, #c66); }

  .footer { display: flex; justify-content: space-between; gap: 8px; margin-top: 18px; }
</style>
