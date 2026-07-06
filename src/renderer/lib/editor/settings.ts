export interface EditorSettings {
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  showWhitespace: boolean;
  alwaysCollapseFrontmatter: boolean;
  /** Prefix rendered H2s with a "§ 01" section numeral in the preview (#1120).
   *  Off by default — only long-form/essay notes want it, so it's a setting
   *  rather than firing on every journal or list. */
  numberedHeadings: boolean;
}

const STORAGE_KEY = 'editorSettings';

const DEFAULTS: EditorSettings = {
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  showWhitespace: false,
  alwaysCollapseFrontmatter: false,
  numberedHeadings: false,
};

export function getEditorSettings(): EditorSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULTS, ...(JSON.parse(stored) as Partial<EditorSettings>) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export function saveEditorSettings(settings: EditorSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
