/**
 * Per-project config (`.minerva/config.json`).
 *
 * The graph module already writes a `baseUri` here on first open; this
 * module is the home for everything else that's project-scoped — currently
 * the bibliography style. Read/write merge with whatever is on disk so
 * unrelated keys (notably `baseUri`) survive when one feature writes its
 * own slice.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ProjectConfigShape {
  baseUri?: string;
  bibliography?: {
    /** CSL style id; one of BUNDLED_STYLES keys. Falls back to APA. */
    styleId?: string;
  };
  // Compute trust moved out of the project config to per-machine, content-
  // addressed consent (#1412 — the config lived in the shareable thoughtbase, a
  // trust-transfer hole). See `src/main/compute/consent.ts`.
  /** New-thoughtbase onboarding journey state. Per-project so the
   *  user can disable it for an empty scratch thoughtbase without
   *  blocking the modal on their next fresh one. */
  onboarding?: {
    /** User chose "Don't show again" — the modal won't reappear for
     *  this thoughtbase even if it's reopened while still empty. */
    dismissed?: boolean;
  };
  /** Excerpt → Note flow defaults (#101). */
  excerpt?: {
    /** Project-relative folder where "New note from excerpt" lands.
     *  Empty string means the project root. */
    noteFolder?: string;
  };
  /** Git-push publish destinations (#254). */
  publish?: {
    targets?: PublishTarget[];
  };
}

/**
 * A configured "Publish → git remote" destination (#254): an exporter
 * paired with a git remote/branch to push its output to (e.g. a static
 * site → GitHub Pages). Stored in `.minerva/config.json`, which is
 * gitignored, so a remote URL never rides along in the thoughtbase repo.
 */
export interface PublishTarget {
  /** Stable id — names the publish-cache workspace and the config entry. */
  id: string;
  /** Human label shown in the Publish menu/dialog. */
  label: string;
  /**
   * Transport kind (#1444). Absent on pre-existing targets ⇒ treated as 'git'.
   * The S3 variant's fields land alongside the git ones in the S3 transport PR.
   */
  kind?: 'git' | 's3';
  /** Exporter id whose directory-tree output gets pushed (e.g. 'static-site'). */
  exporter: string;
  /** Remote URL. SSH forms are normalized to HTTPS at push time (#254 auth). */
  gitRemote: string;
  /** Branch to publish to, e.g. 'gh-pages'. */
  gitBranch: string;
  /** Repo-relative subdirectory the output lands in. '' / '.' = repo root. */
  subdir?: string;
  /** Commit message, with `{{date}}` / `{{version}}` placeholders. */
  commitMessageTemplate?: string;
}

function configPath(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'config.json');
}

export function readProjectConfig(rootPath: string): ProjectConfigShape {
  try {
    const raw = fs.readFileSync(configPath(rootPath), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    return {};
  }
}

/**
 * Merge `patch` into the on-disk config. Top-level keys are replaced
 * wholesale; this is intentional — none of the current consumers want
 * a deep merge, and a shallow one is easy to reason about.
 */
export function patchProjectConfig(rootPath: string, patch: ProjectConfigShape): void {
  const existing = readProjectConfig(rootPath);
  const next: ProjectConfigShape = { ...existing, ...patch };
  fs.mkdirSync(path.dirname(configPath(rootPath)), { recursive: true });
  fs.writeFileSync(configPath(rootPath), JSON.stringify(next, null, 2), 'utf-8');
}

export function getBibliographyStyleId(rootPath: string): string | null {
  return readProjectConfig(rootPath).bibliography?.styleId ?? null;
}

export function setBibliographyStyleId(rootPath: string, styleId: string): void {
  patchProjectConfig(rootPath, { bibliography: { styleId } });
}

/** Per-project onboarding-dismissed flag. Default false (= show modal
 *  when the thoughtbase is empty). Once true, the modal stays
 *  suppressed even if the user later empties the thoughtbase again. */
export function getOnboardingDismissed(rootPath: string): boolean {
  return readProjectConfig(rootPath).onboarding?.dismissed === true;
}

export function setOnboardingDismissed(rootPath: string, dismissed: boolean): void {
  const existing = readProjectConfig(rootPath).onboarding ?? {};
  patchProjectConfig(rootPath, { onboarding: { ...existing, dismissed } });
}

/** Project-relative folder where "New note from excerpt" lands
 *  (#101). Returns '' when unset, which the renderer treats as
 *  "project root". */
export function getExcerptNoteFolder(rootPath: string): string {
  return readProjectConfig(rootPath).excerpt?.noteFolder ?? '';
}

export function setExcerptNoteFolder(rootPath: string, folder: string): void {
  // Normalise: strip leading/trailing slashes and collapse `\` → `/`
  // so the on-disk config is consistent regardless of how the user
  // typed it in the settings field.
  const cleaned = folder
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  const existing = readProjectConfig(rootPath).excerpt ?? {};
  patchProjectConfig(rootPath, { excerpt: { ...existing, noteFolder: cleaned } });
}

/** All configured git-push publish targets (#254). Empty when unset. */
export function getPublishTargets(rootPath: string): PublishTarget[] {
  return readProjectConfig(rootPath).publish?.targets ?? [];
}

export function getPublishTarget(rootPath: string, id: string): PublishTarget | null {
  return getPublishTargets(rootPath).find((t) => t.id === id) ?? null;
}

/** Insert or replace a target by id, preserving the rest of the list. */
export function upsertPublishTarget(rootPath: string, target: PublishTarget): void {
  const targets = getPublishTargets(rootPath);
  const idx = targets.findIndex((t) => t.id === target.id);
  if (idx >= 0) targets[idx] = target;
  else targets.push(target);
  patchProjectConfig(rootPath, { publish: { targets } });
}

export function removePublishTarget(rootPath: string, id: string): void {
  const targets = getPublishTargets(rootPath).filter((t) => t.id !== id);
  patchProjectConfig(rootPath, { publish: { targets } });
}
