/**
 * Editor-side dictation coordination (#voice, Phase 2).
 *
 * Bridges the shared voice engine (`getVoiceStore`) to the CodeMirror editor:
 * the first trigger starts recording, the second stops it and drops the
 * transcript in at the cursor. All three entry points — the `Mod-Shift-v`
 * keymap, the command palette, and the right-click menu — funnel through
 * `toggleEditorDictation`.
 *
 * The insertion target (the `EditorView`) is captured when recording starts
 * and reused on stop, so a transcript can't land in the wrong pane if focus
 * shifts to the floating indicator while you speak.
 */

import type { EditorView } from '@codemirror/view';
import { getVoiceStore } from '../voice/voice.svelte';
import { voiceSettings } from '../voice/voice-settings.svelte';

let pendingView: EditorView | null = null;

/**
 * Prepend a space when joining transcribed text onto a preceding word, so
 * "the cat" + "sat" reads "the cat sat" rather than "the catsat". No space
 * after whitespace, an opening bracket, or at the very start of the doc.
 * Pure so it can be unit-tested without an editor.
 */
export function withLeadingSpace(prevChar: string, text: string): string {
  if (!text) return text;
  if (!prevChar) return text; // start of document
  if (/[\s([{“"']$/.test(prevChar)) return text;
  return ` ${text}`;
}

function insertAtCursor(view: EditorView, text: string): void {
  const sel = view.state.selection.main;
  const prevChar = sel.from > 0 ? view.state.sliceDoc(sel.from - 1, sel.from) : '';
  const insert = withLeadingSpace(prevChar, text);
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + insert.length },
    scrollIntoView: true,
  });
}

/**
 * Toggle dictation for the editor. With `view` null (e.g. invoked from the
 * floating indicator after focus moved), a stop still resolves against the
 * view captured at start.
 */
export async function toggleEditorDictation(view: EditorView | null): Promise<void> {
  if (!voiceSettings.enabled) return;
  const voice = getVoiceStore();

  if (voice.recording && voice.surface === 'editor') {
    const target = pendingView ?? view;
    pendingView = null;
    const text = await voice.stopAndTranscribe();
    if (text && target) {
      insertAtCursor(target, text);
      target.focus();
    }
    return;
  }

  if (voice.status === 'idle') {
    pendingView = view;
    await voice.start('editor');
    view?.focus();
  }
}

/** Abandon an in-flight editor dictation without inserting anything. */
export function cancelEditorDictation(): void {
  pendingView = null;
  getVoiceStore().cancel();
}

/** True while a recording owned by the editor surface is live. */
export function isEditorDictating(): boolean {
  const voice = getVoiceStore();
  return voice.surface === 'editor' && voice.recording;
}
