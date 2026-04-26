import type { Command } from '@codemirror/view';
import { toggleCase, joinLines, duplicateLine, sortLines, extendSelection, shrinkSelection } from './commands';
import {
  toggleBold, toggleItalic, toggleCode, toggleStrikethrough,
  toggleH1, toggleH2, toggleH3, toggleQuote, toggleBulletList, toggleNumberedList, toggleTaskList,
  insertTable, insertHorizontalRule, insertFootnote, insertLink, insertImage, insertWikiLink,
} from './formatting';

export interface CommandEntry {
  id: string;
  label: string;
  defaultKey: string;
  command: Command;
}

/** Central registry of all editor commands with default key bindings */
export const COMMAND_REGISTRY: CommandEntry[] = [
  // Text manipulation
  { id: 'editor.toggleCase', label: 'Toggle Case', defaultKey: 'Mod-Shift-u', command: toggleCase },
  { id: 'editor.joinLines', label: 'Join Lines', defaultKey: 'Ctrl-Shift-j', command: joinLines },
  { id: 'editor.duplicateLine', label: 'Duplicate Line', defaultKey: 'Mod-d', command: duplicateLine },
  { id: 'editor.sortLines', label: 'Sort Lines', defaultKey: '', command: sortLines },

  // Selection
  { id: 'editor.extendSelection', label: 'Extend Selection', defaultKey: 'Alt-ArrowUp', command: extendSelection },
  { id: 'editor.shrinkSelection', label: 'Shrink Selection', defaultKey: 'Alt-ArrowDown', command: shrinkSelection },

  // Inline formatting
  { id: 'editor.toggleBold', label: 'Bold', defaultKey: 'Mod-b', command: toggleBold },
  { id: 'editor.toggleItalic', label: 'Italic', defaultKey: 'Mod-i', command: toggleItalic },
  { id: 'editor.toggleCode', label: 'Code', defaultKey: 'Mod-e', command: toggleCode },
  { id: 'editor.toggleStrikethrough', label: 'Strikethrough', defaultKey: 'Mod-Shift-x', command: toggleStrikethrough },

  // Paragraph
  { id: 'editor.toggleH1', label: 'Heading 1', defaultKey: '', command: toggleH1 },
  { id: 'editor.toggleH2', label: 'Heading 2', defaultKey: '', command: toggleH2 },
  { id: 'editor.toggleH3', label: 'Heading 3', defaultKey: '', command: toggleH3 },
  { id: 'editor.toggleQuote', label: 'Quote', defaultKey: '', command: toggleQuote },
  { id: 'editor.toggleBulletList', label: 'Bulleted List', defaultKey: '', command: toggleBulletList },
  { id: 'editor.toggleNumberedList', label: 'Numbered List', defaultKey: '', command: toggleNumberedList },
  { id: 'editor.toggleTaskList', label: 'Task List', defaultKey: '', command: toggleTaskList },

  // Insert
  { id: 'editor.insertLink', label: 'Insert Link', defaultKey: 'Mod-k', command: insertLink },
  { id: 'editor.insertWikiLink', label: 'Insert Wiki Link', defaultKey: '', command: insertWikiLink },
  { id: 'editor.insertImage', label: 'Insert Image', defaultKey: '', command: insertImage },
  { id: 'editor.insertTable', label: 'Insert Table', defaultKey: '', command: insertTable },
  { id: 'editor.insertHorizontalRule', label: 'Insert Horizontal Rule', defaultKey: '', command: insertHorizontalRule },
  { id: 'editor.insertFootnote', label: 'Insert Footnote', defaultKey: '', command: insertFootnote },
];

export interface KeyBindingOverride {
  key: string;
  command: string;
}

const STORAGE_KEY = 'keybindingOverrides';

export function getOverrides(): KeyBindingOverride[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as KeyBindingOverride[];
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
  const commandMap = new Map(COMMAND_REGISTRY.map((c) => [c.id, c.command]));

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
