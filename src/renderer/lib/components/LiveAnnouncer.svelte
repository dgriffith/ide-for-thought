<script lang="ts">
  // The app's single pair of screen-reader live regions (#2374). Mounted once
  // (FeatureDialogHost) and never conditionally, so each is already in the
  // accessibility tree before its text changes — the precondition for a live
  // region to be spoken at all. Visually hidden; see announcer.svelte.ts for
  // what gets announced and why.
  import { getAnnouncerStore } from '../stores/announcer.svelte';

  const announcer = getAnnouncerStore();
</script>

<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="live-announcer-polite">{announcer.polite}</div>
<div class="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true" data-testid="live-announcer-assertive">{announcer.assertive}</div>
