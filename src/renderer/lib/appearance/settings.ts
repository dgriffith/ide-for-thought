import { applyDensity, getDensity } from './density';

export type FontFamilyPreset =
  | 'default'
  | 'system'
  | 'serif'
  | 'monospace'
  | 'jetbrainsMono'
  | 'berkeleyMono'
  | 'systemMono';

interface PresetDef {
  label: string;
  /** null means: don't set --content-font-family, let --font-mono win. */
  css: string | null;
}

export const FONT_FAMILY_PRESETS: Record<FontFamilyPreset, PresetDef> = {
  default: { label: 'Minerva default (Plex)', css: null },
  system: {
    label: 'System Sans',
    css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  serif: { label: 'Serif', css: 'Georgia, "Times New Roman", Cambria, serif' },
  monospace: {
    label: 'Monospace',
    css: 'ui-monospace, "SF Mono", "JetBrains Mono", "Fira Code", Menlo, monospace',
  },
  jetbrainsMono: {
    label: 'JetBrains Mono',
    css: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  berkeleyMono: {
    label: 'Berkeley Mono',
    css: '"Berkeley Mono", "TX-02", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  systemMono: {
    label: 'System mono',
    css: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", monospace',
  },
};

const STORAGE_KEY = 'fontFamily';

export function getFontFamily(): FontFamilyPreset {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored in FONT_FAMILY_PRESETS) return stored as FontFamilyPreset;
  return 'default';
}

export function setFontFamily(preset: FontFamilyPreset): void {
  localStorage.setItem(STORAGE_KEY, preset);
  applyFontFamily(preset);
}

export function applyFontFamily(preset: FontFamilyPreset): void {
  const def = FONT_FAMILY_PRESETS[preset];
  if (def.css) {
    document.documentElement.style.setProperty('--content-font-family', def.css);
  } else {
    document.documentElement.style.removeProperty('--content-font-family');
  }
}

export function initAppearance(): void {
  applyFontFamily(getFontFamily());
  applyDensity(getDensity());
}
