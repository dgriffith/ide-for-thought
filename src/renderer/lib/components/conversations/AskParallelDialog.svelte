<script lang="ts">
  /**
   * "Ask in parallel…" (#2974): send the composer's message as several
   * branches at once — on different models, from perspectives the user names,
   * or as repeated attempts — and get the answers side by side.
   *
   * Reads the model list and the branch limit from settings (a read); sending
   * is the caller's, through the conversations store.
   */
  import { onMount } from 'svelte';
  import Dialog from '../ui/Dialog.svelte';
  import { api } from '../../ipc/client';
  import { groupedModelOptions } from '../../../../shared/tools/models';
  import { resolveForkMaxBranches } from '../../../../shared/tools/fork-settings';
  import { MIN_PARALLEL, parallelBranches, type ParallelMode } from '../../../../shared/conversation-parallel';
  import type { CustomModel } from '../../../../shared/tools/types';
  import type { ParallelBranch } from '../../../../shared/conversation';

  interface Props {
    /** The message being asked, shown so the user knows what goes out. */
    message: string;
    onConfirm: (branches: ParallelBranch[]) => void;
    onCancel: () => void;
  }

  let { message, onConfirm, onCancel }: Props = $props();

  let mode = $state<ParallelMode>('models');
  let max = $state(resolveForkMaxBranches(undefined));
  let customModels = $state<CustomModel[]>([]);
  let chosenModels = $state<string[]>([]);
  let perspectives = $state('');
  let attempts = $state(3);

  onMount(async () => {
    try {
      const s = await api.tools.getSettings();
      max = resolveForkMaxBranches(s.forkMaxBranches);
      customModels = s.customModels ? [...s.customModels] : [];
    } catch { /* settings unavailable: the default limit and the stock models still work */ }
  });

  const groups = $derived(groupedModelOptions(customModels));
  const labelOf = (id: string): string =>
    groups.flatMap((g) => g.models).find((m) => m.value === id)?.label ?? id;

  const branches = $derived(
    mode === 'models'
      ? parallelBranches({ mode, models: chosenModels.map((id) => ({ id, label: labelOf(id) })) }, max)
      : mode === 'perspectives'
        ? parallelBranches({ mode, perspectives: perspectives.split('\n') }, max)
        : parallelBranches({ mode, attempts }, max),
  );
  const ready = $derived(branches.length >= MIN_PARALLEL);

  function toggleModel(id: string, on: boolean): void {
    chosenModels = on ? [...chosenModels, id] : chosenModels.filter((m) => m !== id);
  }

  function confirm(): void {
    if (ready) onConfirm(branches);
  }
</script>

<Dialog width={520} onClose={onCancel} titleId="ask-parallel-title">
  {#snippet eyebrow()}Ask in parallel{/snippet}
  {#snippet title()}Ask this several ways at once{/snippet}
  {#snippet subtitle()}Each way is a branch of this conversation. Their answers come back side by side, and you can carry on here or in any branch.{/snippet}
  {#snippet body()}
    <div class="body-inner">
      <blockquote class="asked">{message}</blockquote>
      <fieldset class="modes">
        <legend class="field-label">Ask it</legend>
        <label><input type="radio" name="ask-parallel-mode" value="models" bind:group={mode} /> On different models</label>
        <label><input type="radio" name="ask-parallel-mode" value="perspectives" bind:group={mode} /> From different perspectives</label>
        <label><input type="radio" name="ask-parallel-mode" value="attempts" bind:group={mode} /> Several times</label>
      </fieldset>

      {#if mode === 'models'}
        <fieldset class="choices">
          <legend class="field-label">Models (up to {max})</legend>
          {#each groups as g (g.provider)}
            <div class="group">
              <div class="group-label">{g.label}</div>
              {#each g.models as m (m.value)}
                <label class="choice">
                  <input
                    type="checkbox"
                    checked={chosenModels.includes(m.value)}
                    disabled={!chosenModels.includes(m.value) && chosenModels.length >= max}
                    onchange={(e) => toggleModel(m.value, e.currentTarget.checked)}
                  />
                  {m.label}
                </label>
              {/each}
            </div>
          {/each}
        </fieldset>
      {:else if mode === 'perspectives'}
        <label class="field-label" for="ask-parallel-perspectives">Perspectives, one per line (up to {max})</label>
        <textarea id="ask-parallel-perspectives" class="input" rows="4" bind:value={perspectives} placeholder={'a skeptic\nan engineer\na historian'}></textarea>
      {:else}
        <label class="field-label" for="ask-parallel-attempts">How many times (up to {max})</label>
        <input id="ask-parallel-attempts" class="input attempts" type="number" min={MIN_PARALLEL} {max} bind:value={attempts} />
      {/if}
    </div>
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">{branches.length} branch{branches.length === 1 ? '' : 'es'}</span>{/snippet}
  {#snippet footerRight()}
    <button class="btn ghost" onclick={onCancel}>Cancel</button>
    <button class="btn primary" disabled={!ready} onclick={confirm}>Ask {branches.length >= MIN_PARALLEL ? `${branches.length} ways` : ''}</button>
  {/snippet}
</Dialog>

<style>
  .body-inner { display: flex; flex-direction: column; gap: 12px; }
  .asked {
    margin: 0;
    padding: 6px 10px;
    border-left: 2px solid var(--border);
    color: var(--text-muted);
    font-size: 12.5px;
    white-space: pre-wrap;
    max-height: 6em;
    overflow-y: auto;
  }
  fieldset { border: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .field-label { font-size: 12px; color: var(--text-muted); margin-bottom: 2px; }
  .modes label, .choice { font-size: 13px; color: var(--text); display: flex; gap: 6px; align-items: center; }
  .choices { max-height: 14em; overflow-y: auto; }
  .group { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
  .group-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.04em; }
  .input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    box-sizing: border-box;
  }
  .input:focus { outline: none; border-color: var(--accent); }
  .attempts { width: 6em; }
  .kbd-hint { font-size: 11.5px; color: var(--text-muted); }
  .btn {
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 12.5px;
    cursor: pointer;
    border: 1px solid var(--border);
  }
  .btn.ghost { background: transparent; color: var(--text); }
  .btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .btn:disabled { opacity: 0.5; cursor: default; }
</style>
