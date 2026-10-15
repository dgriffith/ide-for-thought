<script lang="ts">
  /**
   * Settings → Ontology (#2788): the thoughtbase's own vocabularies.
   *
   * Import Turtle… shows what a file declares — its prefixes, classes and
   * properties, and anything refused and why — before anything is saved. An
   * accepted file is copied into `.minerva/ontology/` and loaded beside the
   * built-in ontology: its prefixes work in every query, and its terms show in
   * completion and in the schema the model reads.
   */
  import { onMount } from 'svelte';
  import { getOntologyStore } from '../stores/ontology.svelte';
  import { getNotebaseStore } from '../stores/notebase.svelte';
  import type { VocabularyStatus } from '../../../shared/ontology-vocabularies';

  const ontology = getOntologyStore();
  const notebase = getNotebaseStore();

  onMount(() => {
    if (notebase.meta) void ontology.refresh();
  });

  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  function summary(s: Extract<VocabularyStatus, { ok: true }>): string {
    return `${count(s.classes.length, 'class', 'classes')} · ${count(s.properties.length, 'property', 'properties')}`;
  }
</script>

{#if !notebase.meta}
  <p class="hint">Open a thoughtbase to import vocabularies into it.</p>
{:else}
  <div class="field">
    <span class="field-label">Vocabularies</span>
    <p class="hint">
      Turtle files that add classes, properties and prefixes to this
      thoughtbase's graph, beside Minerva's own. A vocabulary's prefixes work in
      every query without a <code>PREFIX</code> line. It can add terms but not
      change Minerva's, and it travels with the thoughtbase in
      <code>.minerva/ontology/</code>.
    </p>

    {#if ontology.statuses.length === 0}
      <p class="hint empty">No vocabularies yet.</p>
    {:else}
      <ul class="vocab-list" aria-label="Vocabularies">
        {#each ontology.statuses as s (s.file)}
          <li class:refused={!s.ok}>
            <div class="vocab-row">
              <span class="vocab-file">{s.file}</span>
              {#if s.ok}
                <span class="vocab-prefixes">{s.prefixes.map((p) => `${p.prefix}:`).join(' ')}</span>
                <span class="vocab-counts">{summary(s)}</span>
              {:else}
                <span class="vocab-counts">Not loaded</span>
              {/if}
              <button class="link-btn" onclick={() => { void ontology.remove(s.file); }} disabled={ontology.busy}
                aria-label={`Remove ${s.file}`}>Remove</button>
            </div>
            {#if !s.ok}
              <ul class="problems">
                {#each s.problems as problem, i (i)}<li>{problem}</li>{/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if ontology.preview}
      {@const p = ontology.preview}
      <section class="review" aria-label={`Review ${p.file}`}>
        <h4>{p.replaces ? `Replace ${p.file}` : `Import as ${p.file}`}</h4>
        {#if p.status.ok}
          {#if p.status.prefixes.length > 0}
            <p class="review-line"><span class="review-key">Prefixes</span>
              {#each p.status.prefixes as pre (pre.prefix)}<code title={pre.iri}>{pre.prefix}:</code> {/each}</p>
          {/if}
          {#if p.status.classes.length > 0}
            <p class="review-line"><span class="review-key">Classes</span>
              {p.status.classes.map((t) => t.label ?? t.curie ?? t.iri).join(', ')}</p>
          {/if}
          {#if p.status.properties.length > 0}
            <p class="review-line"><span class="review-key">Properties</span>
              {p.status.properties.map((t) => t.label ?? t.curie ?? t.iri).join(', ')}</p>
          {/if}
          <p class="hint">{p.status.triples} triples.</p>
          {#each p.status.notes as note, i (i)}<p class="hint">{note}</p>{/each}
          <div class="review-actions">
            <button class="action-btn" onclick={() => { void ontology.confirmImport(); }} disabled={ontology.busy}>
              {p.replaces ? 'Replace' : 'Import'}
            </button>
            <button class="action-btn" onclick={ontology.cancelImport}>Cancel</button>
          </div>
        {:else}
          <p class="hint">It can't be imported:</p>
          <ul class="problems">
            {#each p.status.problems as problem, i (i)}<li>{problem}</li>{/each}
          </ul>
          <div class="review-actions">
            <button class="action-btn" onclick={ontology.cancelImport}>Close</button>
          </div>
        {/if}
      </section>
    {:else}
      <button class="action-btn" onclick={() => { void ontology.pickImport(); }} disabled={ontology.busy}>
        Import Turtle…
      </button>
    {/if}

    {#if ontology.error}
      <div class="ontology-error" role="alert">{ontology.error}</div>
    {/if}
  </div>
{/if}

<style>
  .hint {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
  .hint code, .review-line code {
    background: var(--bg-button);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
  }
  .hint.empty { font-style: italic; margin: 0 0 8px 0; }
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
  .link-btn {
    padding: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: underline;
    cursor: pointer;
  }
  .link-btn:hover { color: var(--text); }
  .vocab-list {
    list-style: none;
    margin: 0 0 8px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .vocab-list > li {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    font-size: 12px;
  }
  .vocab-row { display: flex; align-items: baseline; gap: 10px; }
  .vocab-file {
    flex: 1;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vocab-prefixes, .vocab-counts { font-size: 11px; color: var(--text-muted); }
  .vocab-prefixes { font-family: var(--font-mono, ui-monospace, monospace); }
  .problems {
    margin: 4px 0 2px 0;
    padding-left: 18px;
    color: var(--text);
    font-size: 11px;
    line-height: 1.45;
  }
  .review {
    margin: 4px 0 8px 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 3px;
  }
  .review h4 { margin: 0 0 6px 0; font-size: 12px; color: var(--text); }
  .review-line { margin: 2px 0; font-size: 12px; color: var(--text); line-height: 1.45; }
  .review-key { color: var(--text-muted); margin-right: 6px; }
  .review-actions { display: flex; gap: 8px; margin-top: 8px; }
  .ontology-error {
    margin-top: 8px;
    padding: 6px 10px;
    border-left: 3px solid var(--accent);
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    white-space: pre-wrap;
  }
</style>
