<script lang="ts">
  /** AI settings, bound into the dialog's state (saved on Done) — #2626. */
  import AiSettings from '../AiSettings.svelte';
  import { api } from '../../ipc/client';
  import type { SettingsHost } from './sections';
  let { host }: { host: SettingsHost } = $props();
</script>

<AiSettings
  bind:model={() => host.model, (v) => (host.model = v)}
  bind:effort={() => host.effort, (v) => (host.effort = v)}
  bind:autoTitle={() => host.autoTitle, (v) => (host.autoTitle = v)}
  bind:providerInputs={() => host.providerInputs, (v) => (host.providerInputs = v)}
  bind:customModels={() => host.customModels, (v) => (host.customModels = v)}
  providerViews={host.providerViews}
  secureStorageAvailable={host.secureStorageAvailable}
  secureStorageReason={host.secureStorageReason}
  onCheckConnection={(providerId, candidateKey, baseURL) => api.tools.checkConnection(providerId, candidateKey, baseURL)}
/>
