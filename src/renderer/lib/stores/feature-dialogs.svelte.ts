/**
 * Feature-dialog visibility state, extracted from App.svelte (#2236, epic #2241).
 *
 * `dialogs.svelte.ts` took the *generic* modal primitives at #670 and recorded
 * why the rest stayed behind: "Feature-specific dialogs … close over feature
 * handlers and aren't general primitives." That was true of the mechanism
 * available then. The ops-bag pattern (#1922 / #2049, now in CLAUDE.md, with
 * `Sidebar.svelte` as the worked example) removed the constraint: a component
 * can take its feature handlers as one typed object and stop needing to be
 * defined where those handlers live. So the state moves here and
 * `FeatureDialogHost.svelte` renders it.
 *
 * ── What this is and isn't ──────────────────────────────────────────────────
 * It is **visibility state only** — which dialog is open, and the payload it
 * was opened with. No `api.*` calls, no feature logic. That is the whole
 * reason it can leave App: what was entangled was never the flags, only the
 * handlers, and those now travel separately.
 *
 * Dialogs whose state already lives in a feature store (`sourceFlow`'s OCR /
 * mine-references / resolve-stub, `refactorFlow`'s auto-link and auto-tag
 * reviews, `linkDrag`, `busy`) are deliberately NOT duplicated here — the host
 * reads those stores directly. This holds only the flags App.svelte itself was
 * carrying.
 */
import type { TypeEditorInitial } from '../components/type-editor-value';
import type { SafeDeleteBlocker } from '../../../shared/types';

/** Which Settings tab to land on. `undefined` = the dialog's own default. */
export type SettingsTab = 'ai' | undefined;

/** Open Type-editor state (#1585): what to pre-fill, and which note gets
 *  promoted to the new type once it saves. */
export interface TypeEditorRequest {
  initial: TypeEditorInitial;
  promoteNotePath: string;
}

/** Open SaveQueryDialog state. The callbacks belong to whoever asked for the
 *  save — the query panel — so they ride along with the request rather than
 *  being re-derived by the host. */
export interface SaveQueryRequest {
  initialName: string;
  initialScope: 'project' | 'global';
  onConfirm: (args: { name: string; scope: 'project' | 'global' }) => void;
  onCancel: () => void;
}

/**
 * Open safe-delete blocker state. `proceed` is the deletion the user is being
 * warned about; the dialog calls it only on "Delete anyway", so the closure
 * carries the work rather than the host reconstructing it.
 */
export interface SafeDeleteRequest {
  selectionCount: number;
  targets: string[];
  blockers: SafeDeleteBlocker[];
  proceed: () => void | Promise<void>;
}

export type FindInNotesMode = 'find' | 'replace' | null;

// Module-level runes: `.svelte.ts` keeps them reactive after the move, and the
// store is a singleton per renderer process the same way every other store here
// is.
let settings = $state(false);
let settingsTab = $state<SettingsTab>(undefined);
let onboarding = $state(false);
let thoughtbaseProperties = $state(false);
let editSavedViews = $state(false);
let editSavedQueries = $state(false);
let about = $state(false);
let shortcuts = $state(false);
let gotoLine = $state(false);
let gotoNote = $state(false);
let commandPalette = $state(false);
let publish = $state(false);
let exportGroup = $state<string | null>(null);
let mergePickerSource = $state<string | null>(null);
let attachEvidenceExcerptId = $state<string | null>(null);
let typeEditor = $state<TypeEditorRequest | null>(null);
let saveQuery = $state<SaveQueryRequest | null>(null);
let safeDelete = $state<SafeDeleteRequest | null>(null);
let findInNotes = $state<FindInNotesMode>(null);

export function getFeatureDialogStore() {
  return {
    // ── Simple visibility flags ───────────────────────────────────────────
    get settings() { return settings; },
    /** Which tab the Settings dialog opens on; cleared when it closes. */
    get settingsTab() { return settingsTab; },
    openSettings(tab?: SettingsTab) { settings = true; settingsTab = tab; },
    closeSettings() { settings = false; settingsTab = undefined; },

    get onboarding() { return onboarding; },
    setOnboarding(open: boolean) { onboarding = open; },

    get thoughtbaseProperties() { return thoughtbaseProperties; },
    setThoughtbaseProperties(open: boolean) { thoughtbaseProperties = open; },

    get editSavedViews() { return editSavedViews; },
    setEditSavedViews(open: boolean) { editSavedViews = open; },

    get editSavedQueries() { return editSavedQueries; },
    setEditSavedQueries(open: boolean) { editSavedQueries = open; },

    get about() { return about; },
    setAbout(open: boolean) { about = open; },

    get shortcuts() { return shortcuts; },
    setShortcuts(open: boolean) { shortcuts = open; },

    get gotoLine() { return gotoLine; },
    setGotoLine(open: boolean) { gotoLine = open; },

    get gotoNote() { return gotoNote; },
    setGotoNote(open: boolean) { gotoNote = open; },
    toggleGotoNote() { gotoNote = !gotoNote; },

    get commandPalette() { return commandPalette; },
    setCommandPalette(open: boolean) { commandPalette = open; },
    toggleCommandPalette() { commandPalette = !commandPalette; },

    get publish() { return publish; },
    setPublish(open: boolean) { publish = open; },

    // ── Flags carrying a payload ──────────────────────────────────────────
    /** Export-dialog scope group id, or null when closed. */
    get exportGroup() { return exportGroup; },
    setExportGroup(group: string | null) { exportGroup = group; },

    /** The source path being merged FROM — the picker chooses the target. */
    get mergePickerSource() { return mergePickerSource; },
    setMergePickerSource(path: string | null) { mergePickerSource = path; },

    /** Excerpt whose attach-as-evidence dialog is open (#1073). */
    get attachEvidenceExcerptId() { return attachEvidenceExcerptId; },
    setAttachEvidenceExcerptId(id: string | null) { attachEvidenceExcerptId = id; },

    get typeEditor() { return typeEditor; },
    setTypeEditor(request: TypeEditorRequest | null) { typeEditor = request; },

    get saveQuery() { return saveQuery; },
    setSaveQuery(request: SaveQueryRequest | null) { saveQuery = request; },

    get safeDelete() { return safeDelete; },
    setSafeDelete(request: SafeDeleteRequest | null) { safeDelete = request; },

    get findInNotes() { return findInNotes; },
    setFindInNotes(mode: FindInNotesMode) { findInNotes = mode; },
  };
}
