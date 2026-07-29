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
import { encryptSecret, decryptSecret } from './secret-storage';

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
interface PublishTargetBase {
  /** Stable id — names the publish-cache workspace and the config entry. */
  id: string;
  /** Human label shown in the Publish menu/dialog. */
  label: string;
  /** Exporter id whose directory-tree output gets pushed (e.g. 'static-site'). */
  exporter: string;
  /** Output subdirectory / key prefix. '' / '.' = root. */
  subdir?: string;
}

/** Publish → git remote (#254). `kind` absent ⇒ git (pre-#1444 targets). */
export interface GitPublishTarget extends PublishTargetBase {
  kind?: 'git';
  /** Remote URL. SSH forms are normalized to HTTPS at push time (#254 auth). */
  gitRemote: string;
  /** Branch to publish to, e.g. 'gh-pages'. */
  gitBranch: string;
  /** Commit message, with `{{date}}` / `{{version}}` placeholders. */
  commitMessageTemplate?: string;
}

/**
 * Publish → S3 / S3-compatible object storage (#1444). One shape covers Amazon
 * S3 and R2/B2/Spaces/MinIO via a custom `endpoint`. The secret access key is
 * NEVER carried on this (wire) shape: it's stored encrypted on disk and only
 * `hasSecret` crosses to the renderer; `secretAccessKey` is a WRITE-ONLY,
 * tri-state field accepted on upsert (string sets, '' clears, omitted keeps) —
 * mirroring the BYOM per-provider key handling.
 */
export interface S3PublishTarget extends PublishTargetBase {
  kind: 's3';
  bucket: string;
  /** Custom endpoint for S3-compatible providers; omit for Amazon S3. */
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  /** Write-only on upsert; never returned by the read path. */
  secretAccessKey?: string;
  /** Read-only: a secret is stored. */
  hasSecret?: boolean;
}

export type PublishTarget = GitPublishTarget | S3PublishTarget;

/** On-disk S3 target: the encrypted secret replaces the plaintext write field. */
type StoredS3Target = Omit<S3PublishTarget, 'secretAccessKey' | 'hasSecret'> & { secretAccessKeyEnc?: string };
type StoredTarget = GitPublishTarget | StoredS3Target;

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

function readStoredTargets(rootPath: string): StoredTarget[] {
  return (readProjectConfig(rootPath).publish?.targets as StoredTarget[] | undefined) ?? [];
}

/** Map an on-disk target to its wire form — for S3, replace the encrypted
 *  secret with a `hasSecret` flag so the plaintext never reaches the renderer. */
function toWireTarget(t: StoredTarget): PublishTarget {
  if (t.kind === 's3') {
    const { secretAccessKeyEnc, ...rest } = t;
    return { ...rest, hasSecret: !!secretAccessKeyEnc };
  }
  return t;
}

/** All configured publish targets (#254, #1444), secrets stripped. Empty when unset. */
export function getPublishTargets(rootPath: string): PublishTarget[] {
  return readStoredTargets(rootPath).map(toWireTarget);
}

export function getPublishTarget(rootPath: string, id: string): PublishTarget | null {
  return getPublishTargets(rootPath).find((t) => t.id === id) ?? null;
}

/**
 * Decrypted S3 credentials for a target (#1444) — main-only, for the transport
 * at publish time. Never crosses to the renderer. Empty for non-S3 / unknown ids.
 */
export function getS3Credentials(rootPath: string, id: string): { accessKeyId?: string; secretAccessKey?: string } {
  const t = readStoredTargets(rootPath).find((x) => x.id === id);
  if (!t || t.kind !== 's3') return {};
  return {
    ...(t.accessKeyId ? { accessKeyId: t.accessKeyId } : {}),
    ...(t.secretAccessKeyEnc ? { secretAccessKey: decryptSecret(t.secretAccessKeyEnc) } : {}),
  };
}

/** Wire → on-disk: for S3, apply the tri-state secret (string sets/encrypts,
 *  '' clears, omitted keeps the existing encrypted value) and drop the plaintext. */
function toStoredTarget(target: PublishTarget, existing: StoredTarget | undefined): StoredTarget {
  if (target.kind !== 's3') return target;
  const { secretAccessKey, hasSecret: _hasSecret, ...rest } = target;
  const prevEnc = existing && existing.kind === 's3' ? existing.secretAccessKeyEnc : undefined;
  const enc = secretAccessKey === undefined ? prevEnc
    : secretAccessKey === '' ? undefined
    : encryptSecret(secretAccessKey);
  return { ...rest, ...(enc ? { secretAccessKeyEnc: enc } : {}) };
}

/** Insert or replace a target by id, preserving the rest of the list (and other
 *  targets' encrypted secrets — CRUD operates on the STORED shape). */
export function upsertPublishTarget(rootPath: string, target: PublishTarget): void {
  const targets = readStoredTargets(rootPath);
  const idx = targets.findIndex((t) => t.id === target.id);
  const stored = toStoredTarget(target, idx >= 0 ? targets[idx] : undefined);
  if (idx >= 0) targets[idx] = stored;
  else targets.push(stored);
  patchProjectConfig(rootPath, { publish: { targets } });
}

export function removePublishTarget(rootPath: string, id: string): void {
  const targets = readStoredTargets(rootPath).filter((t) => t.id !== id);
  patchProjectConfig(rootPath, { publish: { targets } });
}
