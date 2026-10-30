import type { Command } from '@codemirror/view';
import { COMMANDS, type EditorCommandId } from '../../../shared/commands';
import { toggleTabFocusMode } from '@codemirror/commands';
import { toggleCase, joinLines, duplicateLine, sortLines, extendSelection, shrinkSelection } from './commands';
import {
  toggleBold, toggleItalic, toggleCode, toggleStrikethrough, toggleHighlight,
  toggleH1, toggleH2, toggleH3, toggleQuote, toggleBulletList, toggleNumberedList, toggleTaskList,
  insertTable, insertHorizontalRule, insertFootnote, insertLink, insertImage, insertWikiLink,
} from './formatting';
import { toggleEditorDictation } from './dictation';
import { getAudioRecordingStore } from '../voice/audio-recording.svelte';

/** Voice dictation toggle (#voice). Fires the async start/stop+insert against
 *  the focused view; returns true so the key isn't typed into the doc. */
const dictate: Command = (view) => {
  void toggleEditorDictation(view);
  return true;
};

/** Start / stop an audio recording that's saved into the thoughtbase and
 *  embedded at the cursor (#2428). */
const recordAudio: Command = (view) => {
  void getAudioRecordingStore().toggle(() => view);
  return true;
};

/** Start / stop a meeting recording: the mic plus system audio (#2731). */
const recordMeeting: Command = (view) => {
  void getAudioRecordingStore().toggle(() => view, { systemAudio: true });
  return true;
};

/** Transcribe the audio recording embedded on the cursor's line (#2428). */
const transcribeRecording: Command = (view) => {
  void getAudioRecordingStore().transcribeAtCursor(() => view);
  return true;
};

export interface CommandEntry {
  id: EditorCommandId;
  label: string;
  defaultKey: string;
  command: Command;
}

/**
 * What each editor command does (#2625). The commands themselves — id, label,
 * default key — are declared in `shared/commands.ts`; this is their CodeMirror
 * half, keyed by `EditorCommandId`, so a declared editor command with no
 * implementation doesn't compile.
 */
export const EDITOR_COMMANDS: Record<EditorCommandId, Command> = {
  'editor.toggleCase': toggleCase,
  'editor.joinLines': joinLines,
  'editor.duplicateLine': duplicateLine,
  'editor.sortLines': sortLines,
  'editor.extendSelection': extendSelection,
  'editor.shrinkSelection': shrinkSelection,
  'editor.toggleTabFocusMode': toggleTabFocusMode,
  'editor.toggleBold': toggleBold,
  'editor.toggleItalic': toggleItalic,
  'editor.toggleCode': toggleCode,
  'editor.toggleStrikethrough': toggleStrikethrough,
  'editor.toggleHighlight': toggleHighlight,
  'editor.toggleH1': toggleH1,
  'editor.toggleH2': toggleH2,
  'editor.toggleH3': toggleH3,
  'editor.toggleQuote': toggleQuote,
  'editor.toggleBulletList': toggleBulletList,
  'editor.toggleNumberedList': toggleNumberedList,
  'editor.toggleTaskList': toggleTaskList,
  'edit.dictate': dictate,
  'editor.recordAudio': recordAudio,
  'editor.recordMeeting': recordMeeting,
  'editor.transcribeRecording': transcribeRecording,
  'editor.insertLink': insertLink,
  'editor.insertWikiLink': insertWikiLink,
  'editor.insertImage': insertImage,
  'editor.insertTable': insertTable,
  'editor.insertHorizontalRule': insertHorizontalRule,
  'editor.insertFootnote': insertFootnote,
};

/** Every editor command with its default key, in declared order. */
export const COMMAND_REGISTRY: CommandEntry[] = COMMANDS.flatMap((def): CommandEntry[] =>
  'editor' in def
    ? [{ id: def.id, label: def.title, defaultKey: ('key' in def.editor ? def.editor.key : '') ?? '', command: EDITOR_COMMANDS[def.id] }]
    : [],
);

export interface KeyBindingOverride {
  key: string;
  command: string;
}

const STORAGE_KEY = 'keybindingOverrides';

/**
 * Commands that were renamed, so a user's override saved under the old id
 * still applies. `editor.dictate` folded into `edit.dictate` (#2758).
 */
const RENAMED_COMMANDS: Readonly<Record<string, string>> = { 'editor.dictate': 'edit.dictate' };

export function getOverrides(): KeyBindingOverride[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return (JSON.parse(stored) as KeyBindingOverride[]).map((o) => ({ ...o, command: RENAMED_COMMANDS[o.command] ?? o.command }));
    }
  } catch { /* ignore */ }
  return [];
}

export function saveOverrides(overrides: KeyBindingOverride[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

/** Build a key→command map merging defaults with user overrides */
export function resolveKeyBindings(): { key: string; command: Command }[] {
  const overrides = getOverrides();
  const overrideMap = new Map(overrides.map((o) => [o.command, o.key]));
  const commandMap = new Map<string, Command>(COMMAND_REGISTRY.map((c) => [c.id, c.command]));

  const bindings: { key: string; command: Command }[] = [];

  // Apply defaults, overridden where user has specified
  for (const entry of COMMAND_REGISTRY) {
    const key = overrideMap.get(entry.id) ?? entry.defaultKey;
    if (key) {
      bindings.push({ key, command: entry.command });
    }
  }

  // Add any overrides for commands not in registry (future-proofing)
  for (const override of overrides) {
    if (!COMMAND_REGISTRY.find((c) => c.id === override.command)) {
      const cmd = commandMap.get(override.command);
      if (cmd && override.key) {
        bindings.push({ key: override.key, command: cmd });
      }
    }
  }

  return bindings;
}
