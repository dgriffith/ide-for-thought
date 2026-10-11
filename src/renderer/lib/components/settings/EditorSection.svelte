<script lang="ts">
  /** Editor settings, bound into the dialog's state (saved on Done) — #2626. */
  import EditorSettingsPanel from '../EditorSettings.svelte';
  import type { SettingsHost } from './sections';
  let { host }: { host: SettingsHost } = $props();
</script>

<EditorSettingsPanel bind:editor={() => host.editor, (v) => (host.editor = v)} />
