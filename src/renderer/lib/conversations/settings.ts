/**
 * Conversations-panel behavior settings.
 *
 * Mirrors the synchronous-snapshot pattern used by sidebar/settings.ts —
 * a tiny wrapper around localStorage that the SettingsDialog writes through
 * and the conversations store reads from on project load.
 */

export interface ConversationsSettings {
  /** Open the Conversations panel automatically on project load. Default off,
   *  preserving the "launch hidden, toggle with ⌘/Ctrl+Shift+K" behavior. */
  openOnLoad: boolean;
}

export const DEFAULT_CONVERSATIONS_SETTINGS: ConversationsSettings = {
  openOnLoad: false,
};

const STORAGE_KEY = 'conversationsSettings';

function readFromStorage(): ConversationsSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_CONVERSATIONS_SETTINGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONVERSATIONS_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ConversationsSettings> | null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CONVERSATIONS_SETTINGS };
    return { ...DEFAULT_CONVERSATIONS_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_CONVERSATIONS_SETTINGS };
  }
}

let settings: ConversationsSettings = readFromStorage();

export function getConversationsSettings(): ConversationsSettings {
  return settings;
}

export function setConversationsSettings(patch: Partial<ConversationsSettings>): ConversationsSettings {
  settings = { ...settings, ...patch };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
  return settings;
}

export function __resetConversationsSettingsForTests(): void {
  settings = readFromStorage();
}
