<script lang="ts">
  /**
   * Attach an excerpt as evidence for a claim (#1073) — pick a role
   * (grounds/supports/rebuts) and a target claim, then file the edge as a
   * pending proposal (approval-gated). Claims are read straight from the graph
   * (`thought:Claim` notes); the actual attach is a mutation the host owns.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';

  type Role = 'grounds' | 'supports' | 'rebuts';

  interface Props {
    excerptId: string;
    onClose: () => void;
    /** File the evidence edge; the host calls api.graph.attachExcerptEvidence. */
    onAttach: (claimPath: string, role: Role) => void;
  }
  let { excerptId, onClose, onAttach }: Props = $props();

  interface Claim { path: string; title: string }
  let claims = $state<Claim[]>([]);
  let loading = $state(true);
  let role = $state<Role>('grounds');
  let claimPath = $state('');

  const ROLES: { id: Role; label: string; hint: string }[] = [
    { id: 'grounds', label: 'Grounds', hint: 'the factual basis the claim rests on' },
    { id: 'supports', label: 'Supports', hint: 'evidence for the claim' },
    { id: 'rebuts', label: 'Rebuts', hint: 'evidence against the claim' },
  ];

  onMount(async () => {
    const { results } = await api.graph.query(
      `SELECT ?path ?title WHERE { ?n a thought:Claim ; minerva:relativePath ?path . OPTIONAL { ?n dc:title ?title } } ORDER BY ?title`,
    );
    claims = (results as Array<{ path?: string; title?: string }>)
      .filter((r): r is { path: string; title?: string } => !!r.path)
      .map((r) => ({ path: r.path, title: r.title || r.path.replace(/\.md$/i, '').split('/').pop() || r.path }));
    if (claims.length > 0) claimPath = claims[0]!.path;
    loading = false;
  });

  function submit(): void {
    if (!claimPath) return;
    onAttach(claimPath, role);
    onClose();
  }
  function overlayKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }
</script>

<div class="overlay" onkeydown={overlayKey} onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Attach excerpt as evidence">
    <h3 class="title">Attach as evidence</h3>
    <p class="sub">Excerpt <span class="mono">{excerptId}</span> — reviewed as a proposal before it's attached.</p>

    <div class="roles">
      {#each ROLES as r (r.id)}
        <label class="role" class:active={role === r.id}>
          <input type="radio" name="role" value={r.id} checked={role === r.id} onchange={() => (role = r.id)} />
          <span class="role-label">{r.label}</span>
          <span class="role-hint">{r.hint}</span>
        </label>
      {/each}
    </div>

    <label class="field">
      <span class="field-label">Claim</span>
      {#if loading}
        <span class="muted">Loading claims…</span>
      {:else if claims.length === 0}
        <span class="muted">No claims in this thoughtbase yet. Mine some with “Extract Key Claims” first.</span>
      {:else}
        <select bind:value={claimPath}>
          {#each claims as c (c.path)}<option value={c.path}>{c.title}</option>{/each}
        </select>
      {/if}
    </label>

    <div class="actions">
      <button class="btn" onclick={onClose}>Cancel</button>
      <button class="btn primary" disabled={!claimPath} onclick={submit}>Propose</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: var(--z-modal); }
  .dialog { width: 460px; max-width: 90vw; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); }
  .title { margin: 0 0 4px; font-size: 15px; color: var(--text); }
  .sub { margin: 0 0 14px; font-size: 12px; color: var(--text-faint); }
  .mono { font-family: var(--font-mono); }
  .roles { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
  .role { display: flex; align-items: baseline; gap: 8px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
  .role.active { border-color: var(--accent); background: color-mix(in oklch, var(--accent) 6%, transparent); }
  .role input { margin: 0; }
  .role-label { font-size: 13px; font-weight: 500; color: var(--text); }
  .role-hint { font-size: 11.5px; color: var(--text-faint); }
  .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 16px; }
  .field-label { font-size: 12px; color: var(--text-muted); }
  .field select { padding: 5px 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--bg-inset); color: var(--text); font-family: inherit; font-size: 13px; }
  .muted { font-size: 12.5px; color: var(--text-faint); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .btn { padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-button); color: var(--text); font-family: inherit; font-size: 12px; cursor: pointer; }
  .btn:hover { border-color: var(--accent); }
  .btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .btn:disabled { opacity: 0.5; cursor: default; }
</style>
