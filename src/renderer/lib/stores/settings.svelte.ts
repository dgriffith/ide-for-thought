/**
 * Settings-config write chokepoint (#1086).
 *
 * The self-contained settings dialogs (SettingsDialog, BibliographySettings,
 * SitesSettings, SkillsSettings, ComputeSettings) read their config directly
 * (reads are allowed in components) but route every *write* through here, so
 * config mutations follow the renderer data-flow rule (CLAUDE.md) like any
 * other state change. Native OS pickers (`csl.importStyle`'s file dialog,
 * `compute.browsePython`, `skills.revealFolder`) that don't change app state
 * on their own stay in the dialogs; here we only front the calls that persist
 * config. Thin passthroughs — the dialogs still own their view state.
 */
import type { MenuConfig } from '../../../shared/skills/menu-config';
import { api } from '../ipc/client';

export function getSettingsStore() {
  return {
    // ── Clipper ───────────────────────────────────────────────────────────
    setClipperEnabled: (enabled: boolean) => api.clipper.setEnabled(enabled),
    regenerateClipperSecret: () => api.clipper.regenerateSecret(),

    // ── Ingest / excerpt (per-machine + per-project) ──────────────────────
    setIngestSettings: (settings: { importUpstreamTags: boolean }) =>
      api.sources.setIngestSettings(settings),
    setExcerptNoteFolder: (folder: string) => api.sources.setExcerptNoteFolder(folder),

    // ── LLM / tools ───────────────────────────────────────────────────────
    setToolSettings: (update: Parameters<typeof api.tools.setSettings>[0]) =>
      api.tools.setSettings(update),

    // ── Bibliography / CSL ────────────────────────────────────────────────
    setBibliographyStyle: (styleId: string) => api.bibliography.setStyle(styleId),
    importCslStyle: () => api.csl.importStyle(),
    importCslLocale: () => api.csl.importLocale(),
    removeCslStyle: (id: string) => api.csl.removeStyle(id),
    removeCslLocale: (id: string) => api.csl.removeLocale(id),

    // ── Privileged sites ──────────────────────────────────────────────────
    addSite: (domain: string, label?: string) => api.sites.add(domain, label),
    removeSite: (id: string) => api.sites.remove(id),
    loginSite: (id: string) => api.sites.login(id),
    logoutSite: (id: string) => api.sites.logout(id),

    // ── Skills ────────────────────────────────────────────────────────────
    importSkill: () => api.skills.import(),
    reloadSkills: () => api.skills.reload(),
    removeSkill: (id: string) => api.skills.remove(id),
    setSkillsMenuConfig: (config: MenuConfig) => api.skills.setMenuConfig(config),

    // ── Compute (Python) ──────────────────────────────────────────────────
    setPythonSettings: (settings: { pythonPath: string }) =>
      api.compute.setPythonSettings(settings),
    restartPythonKernel: () => api.compute.restartPythonKernel(),
  };
}
