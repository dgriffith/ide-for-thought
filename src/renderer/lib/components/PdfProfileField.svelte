<script lang="ts">
  /**
   * The export dialog's PDF style profile picker (#2429): Notes / Essay /
   * Academic, with a line saying what the chosen one does. The dialog shows it
   * for the PDF formats and remembers the choice per thoughtbase.
   */
  import { PDF_PROFILES, isPdfProfile, type PdfProfile } from '../../../shared/export-pdf-profiles';

  interface Props {
    value: PdfProfile;
  }

  let { value = $bindable() }: Props = $props();
  const chosen = $derived(PDF_PROFILES.find((p) => p.id === value) ?? PDF_PROFILES[0]);
</script>

<div class="option-row">
  <label for="pdf-profile">Style</label>
  <select id="pdf-profile" {value} onchange={(e) => { const v = e.currentTarget.value; if (isPdfProfile(v)) value = v; }} aria-describedby="pdf-profile-hint">
    {#each PDF_PROFILES as p (p.id)}
      <option value={p.id} selected={p.id === value}>{p.label}</option>
    {/each}
  </select>
</div>
<p class="profile-hint" id="pdf-profile-hint">{chosen.description}</p>

<style>
  /* The dialog's own option-row layout, which a child component can't reach. */
  .option-row { display: flex; gap: 16px; margin-bottom: 4px; font-size: 12px; }
  .option-row > label:first-child { min-width: 90px; color: var(--text-muted); padding-top: 3px; }
  .profile-hint { margin: 0 0 12px 106px; font-size: 12px; color: var(--text-muted); }
</style>
