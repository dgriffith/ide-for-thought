/**
 * BreadcrumbsBar settings (#476).
 *
 * Just one knob: whether the cursor-driven heading chain trails the
 * file location. Some users want a stable bar that only changes on
 * tab switches; for them the chain's per-cursor-move updates are
 * noise. Off by default to honor "no surprises" — turn on from
 * Settings > Workspace > Behaviors.
 */

export interface BreadcrumbsSettings {
  /** Show the active-heading chain after the file location. */
  showHeadingChain: boolean;
}

export const DEFAULT_BREADCRUMBS_SETTINGS: BreadcrumbsSettings = {
  showHeadingChain: false,
};

const STORAGE_KEY = 'breadcrumbsSettings';

function readFromStorage(): BreadcrumbsSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_BREADCRUMBS_SETTINGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BREADCRUMBS_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<BreadcrumbsSettings> | null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_BREADCRUMBS_SETTINGS };
    return { ...DEFAULT_BREADCRUMBS_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_BREADCRUMBS_SETTINGS };
  }
}

let settings: BreadcrumbsSettings = readFromStorage();

export function getBreadcrumbsSettings(): BreadcrumbsSettings {
  return settings;
}

export function setBreadcrumbsSettings(patch: Partial<BreadcrumbsSettings>): BreadcrumbsSettings {
  settings = { ...settings, ...patch };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
  return settings;
}

export function __resetBreadcrumbsSettingsForTests(): void {
  settings = readFromStorage();
}
