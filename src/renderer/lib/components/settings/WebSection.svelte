<script lang="ts">
  /** Web settings, bound into the dialog's state (saved on Done) — #2626. */
  import WebSettings from '../WebSettings.svelte';
  import type { SettingsHost } from './sections';
  let { host }: { host: SettingsHost } = $props();
</script>

<WebSettings
  bind:webEnabled={() => host.webEnabled, (v) => (host.webEnabled = v)}
  bind:allowedDomainsText={() => host.allowedDomainsText, (v) => (host.allowedDomainsText = v)}
  bind:blockedDomainsText={() => host.blockedDomainsText, (v) => (host.blockedDomainsText = v)}
/>
