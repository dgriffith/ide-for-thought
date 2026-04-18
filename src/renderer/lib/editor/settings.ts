export interface EditorSettings {
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  showWhitespace: boolean;
  alwaysCollapseFrontmatter: boolean;
}

const STORAGE_KEY = 'editorSettings';

const DEFAULTS: EditorSettings = {
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  showWhitespace: false,
  alwaysCollapseFrontmatter: false,
};

export function getEditorSettings(): EditorSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export function saveEditorSettings(settings: EditorSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
