/**
 * Generic modal-dialog store (#670, extracted from App.svelte).
 *
 * Owns the imperative prompt/confirm/new-note/snippet/open-target dialogs that
 * App.svelte used to manage inline. Each `show*` returns a Promise that
 * resolves when the user acts, so callers read like `const name = await
 * showPrompt(...)`. `<DialogHost>` renders the state held here; the resolve/
 * cancel methods are what the host's buttons call.
 *
 * Feature-specific dialogs (mine-references, resolve-stub, safe-delete, export,
 * command palette) stay in App.svelte — they close over feature handlers and
 * aren't general primitives.
 *
 * Runes work in `.svelte.ts`, so the state stays reactive after the move.
 */
import { getConfirmSuppressionStore } from './confirm-suppression.svelte';
import type { NoteExt, NewNoteResult } from '../components/new-note-dialog-types';
import type { TemplateInfo } from '../ipc/client';
import type { TypeInfo } from '../../../shared/objects/type-def';
import type { SourceMetadata } from '../../../shared/types';

export interface PromptState {
  message: string;
  suggestions?: string[] | undefined;
  initial?: string | undefined;
  resolve: (value: string | null) => void;
}
export interface NewNoteState {
  initialExt: NoteExt;
  resolve: (value: NewNoteResult | null) => void;
}
export interface SnippetPickerState {
  templates: TemplateInfo[];
  resolve: (value: TemplateInfo | null) => void;
}
export interface ConfirmState {
  message: string;
  confirmLabel: string;
  key: string;
  hideDontAskAgain?: boolean | undefined;
  resolve: (value: boolean) => void;
}
export type OpenTargetChoice = 'this' | 'new' | 'cancel';
export interface OpenTargetState {
  message: string;
  resolve: (value: OpenTargetChoice) => void;
}
/** Eyes-on-code compute-consent dialog (#1412): shows the code before it runs,
 *  with a "trust all here" escape (the reused checkbox). */
export type ComputeConsentChoice = 'cell' | 'project' | 'cancel';
export interface ComputeConsentState {
  message: string;
  code: string;
  resolve: (value: ComputeConsentChoice) => void;
}
/** Name + typed value collected on one panel by the "Add Property" dialog.
 *  `value` is an already-coerced JS scalar (string / number / boolean, or a
 *  `YYYY-MM-DD` string for dates), ready to hand to `setPropertyInContent`. */
export interface AddPropertyResult {
  name: string;
  value: unknown;
}
export interface AddPropertyState {
  message: string;
  /** Frontmatter-key vocabulary for the name field's autocomplete. */
  keySuggestions: string[];
  resolve: (value: AddPropertyResult | null) => void;
}

/** "Treat this note as a…" type picker (#1067). */
export interface TypePickerState {
  types: TypeInfo[];
  resolve: (value: TypeInfo | null) => void;
}

/** Duplicate-source merge picker (#1446): choose which of the duplicates to
 *  keep; resolves to its sourceId, or null on cancel. */
export interface MergeSourcesState {
  sources: SourceMetadata[];
  resolve: (keepId: string | null) => void;
}

let prompt = $state<PromptState | null>(null);
let newNote = $state<NewNoteState | null>(null);
let snippet = $state<SnippetPickerState | null>(null);
let typePicker = $state<TypePickerState | null>(null);
let mergeSources = $state<MergeSourcesState | null>(null);
let confirm = $state<ConfirmState | null>(null);
let computeConsent = $state<ComputeConsentState | null>(null);
let openTarget = $state<OpenTargetState | null>(null);
let addProperty = $state<AddPropertyState | null>(null);

export function getDialogStore() {
  const confirmSuppression = getConfirmSuppressionStore();

  function showPrompt(
    message: string,
    initialOrOptions?: string | { suggestions?: string[]; initial?: string },
  ): Promise<string | null> {
    // Two overloads to keep call sites readable. New callers pass
    // (message, "current name") for Rename-style flows; existing
    // callers can keep their {suggestions} object.
    const opts = typeof initialOrOptions === 'string'
      ? { initial: initialOrOptions }
      : (initialOrOptions ?? {});
    return new Promise((resolve) => {
      prompt = {
        message,
        suggestions: opts.suggestions,
        initial: opts.initial,
        resolve,
      };
    });
  }

  function showNewNoteDialog(initialExt: NoteExt = '.md'): Promise<NewNoteResult | null> {
    return new Promise((resolve) => {
      newNote = { initialExt, resolve };
    });
  }

  function showConfirm(
    message: string,
    key: string,
    confirmLabel = 'OK',
    options: { hideDontAskAgain?: boolean } = {},
  ): Promise<boolean> {
    if (confirmSuppression.isSuppressed(key)) return Promise.resolve(true);
    return new Promise((resolve) => {
      confirm = { message, confirmLabel, key, hideDontAskAgain: options.hideDontAskAgain, resolve };
    });
  }

  /** Eyes-on-code compute-consent prompt (#1412). Shows `code`, and resolves
   *  'cell' (run just this), 'project' (trust all compute here — the checkbox),
   *  or 'cancel'. Deliberately NOT routed through confirm-suppression: the
   *  "trust all" choice is per-project consent (persisted server-side), not a
   *  global localStorage suppression. */
  function showComputeConsent(message: string, code: string): Promise<ComputeConsentChoice> {
    return new Promise((resolve) => { computeConsent = { message, code, resolve }; });
  }
  function acceptComputeConsent(trustAll: boolean) {
    computeConsent?.resolve(trustAll ? 'project' : 'cell');
    computeConsent = null;
  }
  function cancelComputeConsent() { computeConsent?.resolve('cancel'); computeConsent = null; }

  function showSnippetPicker(templates: TemplateInfo[]): Promise<TemplateInfo | null> {
    return new Promise((resolve) => { snippet = { templates, resolve }; });
  }

  /** Collect a frontmatter property's name + value on a single panel. */
  function showAddPropertyDialog(message: string, keySuggestions: string[]): Promise<AddPropertyResult | null> {
    return new Promise((resolve) => { addProperty = { message, keySuggestions, resolve }; });
  }

  /** Pure open-target prompt — always shows. App.svelte wraps this with the
   *  "no project open → 'this'" shortcut, which is app logic, not dialog logic. */
  function askOpenTarget(message: string): Promise<OpenTargetChoice> {
    return new Promise((resolve) => { openTarget = { message, resolve }; });
  }

  // ── resolve/cancel — called by DialogHost's child-component callbacks ──
  function confirmPrompt(value: string) { prompt?.resolve(value); prompt = null; }
  function cancelPrompt() { prompt?.resolve(null); prompt = null; }

  function confirmNewNote(value: NewNoteResult) { const r = newNote?.resolve; newNote = null; r?.(value); }
  function cancelNewNote() { const r = newNote?.resolve; newNote = null; r?.(null); }

  function pickSnippet(t: TemplateInfo) { const r = snippet?.resolve; snippet = null; r?.(t); }
  function cancelSnippet() { const r = snippet?.resolve; snippet = null; r?.(null); }

  /** Show the "Treat this as a…" type picker; resolves to the chosen type (#1067). */
  function showTypePicker(types: TypeInfo[]): Promise<TypeInfo | null> {
    return new Promise((resolve) => { typePicker = { types, resolve }; });
  }
  function pickType(t: TypeInfo) { const r = typePicker?.resolve; typePicker = null; r?.(t); }
  function cancelTypePicker() { const r = typePicker?.resolve; typePicker = null; r?.(null); }

  /** Show the duplicate-source merge picker; resolves to the kept sourceId (#1446). */
  function showMergeSourcesPicker(sources: SourceMetadata[]): Promise<string | null> {
    return new Promise((resolve) => { mergeSources = { sources, resolve }; });
  }
  function pickMergeSource(keepId: string) { const r = mergeSources?.resolve; mergeSources = null; r?.(keepId); }
  function cancelMergeSources() { const r = mergeSources?.resolve; mergeSources = null; r?.(null); }

  function confirmConfirm(dontAskAgain: boolean) {
    if (dontAskAgain && confirm) confirmSuppression.suppress(confirm.key);
    confirm?.resolve(true);
    confirm = null;
  }
  function cancelConfirm() { confirm?.resolve(false); confirm = null; }

  function resolveOpenTarget(choice: OpenTargetChoice) {
    const r = openTarget?.resolve; openTarget = null; r?.(choice);
  }

  function confirmAddProperty(value: AddPropertyResult) { const r = addProperty?.resolve; addProperty = null; r?.(value); }
  function cancelAddProperty() { const r = addProperty?.resolve; addProperty = null; r?.(null); }

  return {
    get prompt() { return prompt; },
    get newNote() { return newNote; },
    get snippet() { return snippet; },
    get typePicker() { return typePicker; },
    get mergeSources() { return mergeSources; },
    get confirm() { return confirm; },
    get computeConsent() { return computeConsent; },
    get openTarget() { return openTarget; },
    get addProperty() { return addProperty; },
    showPrompt,
    showNewNoteDialog,
    showConfirm,
    showComputeConsent,
    acceptComputeConsent,
    cancelComputeConsent,
    showSnippetPicker,
    showAddPropertyDialog,
    askOpenTarget,
    confirmPrompt,
    cancelPrompt,
    confirmNewNote,
    cancelNewNote,
    pickSnippet,
    cancelSnippet,
    showTypePicker,
    pickType,
    cancelTypePicker,
    showMergeSourcesPicker,
    pickMergeSource,
    cancelMergeSources,
    confirmConfirm,
    cancelConfirm,
    resolveOpenTarget,
    confirmAddProperty,
    cancelAddProperty,
  };
}

// Test-only: clear any in-flight dialog state between cases.
export function __resetDialogsForTests(): void {
  prompt = null;
  newNote = null;
  snippet = null;
  typePicker = null;
  mergeSources = null;
  confirm = null;
  openTarget = null;
  addProperty = null;
}
