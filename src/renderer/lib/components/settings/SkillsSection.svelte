<script lang="ts">
  /** Skills settings, bound into the dialog's state (saved on Done) — #2626. */
  import SkillsSettings from '../SkillsSettings.svelte';
  import type { SettingsHost } from './sections';
  let { host }: { host: SettingsHost } = $props();
</script>

<SkillsSettings
  bind:toolModelOverrides={() => host.toolModelOverrides, (v) => (host.toolModelOverrides = v)}
  defaultModel={host.model}
  customModels={host.customModels}
/>
