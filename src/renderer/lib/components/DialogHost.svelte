<script lang="ts">
  /**
   * Renders the generic modal dialogs held by the dialog store (#670).
   * Mounted once near the root of App.svelte; each `show*` call on the store
   * pops the corresponding dialog here. Keeps the imperative prompt/confirm
   * plumbing out of App.svelte's template.
   */
  import PromptDialog from './PromptDialog.svelte';
  import NewNoteDialog from './NewNoteDialog.svelte';
  import SnippetPickerDialog from './SnippetPickerDialog.svelte';
  import TypePickerDialog from './TypePickerDialog.svelte';
  import MergeSourcesDialog from './MergeSourcesDialog.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import OpenTargetDialog from './OpenTargetDialog.svelte';
  import AddPropertyDialog from './AddPropertyDialog.svelte';
  import { getDialogStore } from '../stores/dialogs.svelte';

  const dialogs = getDialogStore();
</script>

{#if dialogs.prompt}
  <PromptDialog
    message={dialogs.prompt.message}
    suggestions={dialogs.prompt.suggestions ?? []}
    initial={dialogs.prompt.initial ?? ''}
    onConfirm={(v) => dialogs.confirmPrompt(v)}
    onCancel={() => dialogs.cancelPrompt()}
  />
{/if}

{#if dialogs.newNote}
  <NewNoteDialog
    initialExt={dialogs.newNote.initialExt}
    onConfirm={(v) => dialogs.confirmNewNote(v)}
    onCancel={() => dialogs.cancelNewNote()}
  />
{/if}

{#if dialogs.snippet}
  <SnippetPickerDialog
    templates={dialogs.snippet.templates}
    onPick={(t) => dialogs.pickSnippet(t)}
    onCancel={() => dialogs.cancelSnippet()}
  />
{/if}

{#if dialogs.typePicker}
  <TypePickerDialog
    types={dialogs.typePicker.types}
    onPick={(t) => dialogs.pickType(t)}
    onCancel={() => dialogs.cancelTypePicker()}
  />
{/if}

{#if dialogs.mergeSources}
  <MergeSourcesDialog
    sources={dialogs.mergeSources.sources}
    onPick={(keepId) => dialogs.pickMergeSource(keepId)}
    onCancel={() => dialogs.cancelMergeSources()}
  />
{/if}

{#if dialogs.confirm}
  <ConfirmDialog
    message={dialogs.confirm.message}
    confirmLabel={dialogs.confirm.confirmLabel}
    {...(dialogs.confirm.hideDontAskAgain !== undefined ? { hideDontAskAgain: dialogs.confirm.hideDontAskAgain } : {})}
    onConfirm={(dontAskAgain) => dialogs.confirmConfirm(dontAskAgain)}
    onCancel={() => dialogs.cancelConfirm()}
  />
{/if}

{#if dialogs.computeConsent}
  <ConfirmDialog
    message={dialogs.computeConsent.message}
    code={dialogs.computeConsent.code}
    confirmLabel="Run this cell"
    dontAskLabel="Trust all compute in this thoughtbase"
    onConfirm={(trustAll) => dialogs.acceptComputeConsent(trustAll)}
    onCancel={() => dialogs.cancelComputeConsent()}
  />
{/if}

{#if dialogs.openTarget}
  <OpenTargetDialog
    message={dialogs.openTarget.message}
    onThisWindow={() => dialogs.resolveOpenTarget('this')}
    onNewWindow={() => dialogs.resolveOpenTarget('new')}
    onCancel={() => dialogs.resolveOpenTarget('cancel')}
  />
{/if}

{#if dialogs.addProperty}
  <AddPropertyDialog
    message={dialogs.addProperty.message}
    keySuggestions={dialogs.addProperty.keySuggestions}
    onConfirm={(v) => dialogs.confirmAddProperty(v)}
    onCancel={() => dialogs.cancelAddProperty()}
  />
{/if}
