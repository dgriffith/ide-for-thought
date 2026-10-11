<script lang="ts">
  /** Sources settings, bound into the dialog's state (saved on Done) — #2626. */
  import SourcesSettings from '../SourcesSettings.svelte';
  import type { SettingsHost } from './sections';
  let { host }: { host: SettingsHost } = $props();
</script>

<SourcesSettings bind:importUpstreamTags={() => host.importUpstreamTags, (v) => (host.importUpstreamTags = v)} />
