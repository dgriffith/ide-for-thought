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
  /**
   * User-chosen display name (#1443). Decoupled from the folder: renaming here
   * changes the label everywhere the thoughtbase is shown without touching the
   * folder path or any graph IRI. Absent ⇒ fall back to the folder basename.
   */
  displayName?: string;
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
 * A configured publish destination (#254; multi-transport #1444). Non-secret
 * fields (remote URL, bucket, endpoint, region, prefix, access-key id) live in
 * `.minerva/config.json`, which travels with the thoughtbase. Credentials do
 * NOT: they're encrypted in the gitignored `.minerva/secrets.json` so they never
 * ride along in a git-backed / shared thoughtbase — same reasoning that moved
 * compute trust out of the config (#1412).
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
  /**
   * GitHub token (#1508). Same secret contract as S3's key: WRITE-ONLY +
   * tri-state on upsert (string sets, '' clears, omitted keeps), stored
   * encrypted, never returned by the read path. Preferred over the `gh` CLI /
   * `GH_TOKEN` env at push time.
   */
  githubToken?: string;
  /** Read-only: a token is stored. */
  hasToken?: boolean;
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

/** On-disk (config.json) target: non-secret fields only. The encrypted secret
 *  lives in the gitignored `.minerva/secrets.json`. */
type StoredGitTarget = Omit<GitPublishTarget, 'githubToken' | 'hasToken'>;
type StoredS3Target = Omit<S3PublishTarget, 'secretAccessKey' | 'hasSecret'>;
type StoredTarget = StoredGitTarget | StoredS3Target;

/** Encrypted per-target credentials, stored in `.minerva/secrets.json`. */
interface TargetSecret { s3Secret?: string; githubToken?: string }

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

/** The user-chosen display name, or null when unset (#1443). */
export function getDisplayName(rootPath: string): string | null {
  return readProjectConfig(rootPath).displayName?.trim() || null;
}

/** Set (or, with '', clear) the display name. Clearing falls back to the
 *  folder basename via `resolveDisplayName`. */
export function setDisplayName(rootPath: string, name: string): void {
  // Store '' to clear — `getDisplayName` treats empty as unset, so
  // `resolveDisplayName` falls back to the folder basename.
  patchProjectConfig(rootPath, { displayName: name.trim() });
}

/** The name to show for a thoughtbase: the chosen display name, else the
 *  folder basename (#1443). The single resolver every name site calls. */
export function resolveDisplayName(rootPath: string): string {
  return getDisplayName(rootPath) ?? path.basename(rootPath);
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

function secretsPath(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'secrets.json');
}

function readSecrets(rootPath: string): Record<string, TargetSecret> {
  try {
    const parsed = JSON.parse(fs.readFileSync(secretsPath(rootPath), 'utf-8')) as { publishTargets?: Record<string, TargetSecret> };
    return parsed.publishTargets ?? {};
  } catch {
    return {};
  }
}

/** Ensure a rule is present in the Minerva-owned `.minerva/.gitignore`. */
function ensureMinervaGitignored(rootPath: string, rule: string): void {
  const dir = path.join(rootPath, '.minerva');
  const file = path.join(dir, '.gitignore');
  let current = '';
  try { current = fs.readFileSync(file, 'utf-8'); } catch { /* none yet */ }
  if (current.split(/\r?\n/).some((l) => l.trim() === rule)) return;
  fs.mkdirSync(dir, { recursive: true });
  const next = current && !current.endsWith('\n') ? `${current}\n` : current;
  fs.writeFileSync(file, `${next}${rule}\n`, 'utf-8');
}

function writeSecrets(rootPath: string, secrets: Record<string, TargetSecret>): void {
  const file = secretsPath(rootPath);
  if (Object.keys(secrets).length === 0) {
    try { fs.unlinkSync(file); } catch { /* already absent */ }
    return;
  }
  ensureMinervaGitignored(rootPath, 'secrets.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ publishTargets: secrets }, null, 2), 'utf-8');
}

/**
 * Config targets (non-secret) + the per-target secret map, migrating any legacy
 * inline `*Enc` (pre-split, when secrets lived in config.json) out into
 * `secrets.json` on first access — so a git-backed thoughtbase never commits them.
 */
function loadPublishState(rootPath: string): { targets: StoredTarget[]; secrets: Record<string, TargetSecret> } {
  const raw = (readProjectConfig(rootPath).publish?.targets ?? []) as (StoredTarget & { secretAccessKeyEnc?: string; githubTokenEnc?: string })[];
  const secrets = readSecrets(rootPath);
  let migrated = false;
  const targets: StoredTarget[] = raw.map((t) => {
    const { secretAccessKeyEnc, githubTokenEnc, ...rest } = t;
    if (secretAccessKeyEnc || githubTokenEnc) {
      migrated = true;
      const cur = { ...(secrets[t.id] ?? {}) };
      if (secretAccessKeyEnc && !cur.s3Secret) cur.s3Secret = secretAccessKeyEnc;
      if (githubTokenEnc && !cur.githubToken) cur.githubToken = githubTokenEnc;
      secrets[t.id] = cur;
    }
    return rest;
  });
  if (migrated) {
    patchProjectConfig(rootPath, { publish: { targets } });
    writeSecrets(rootPath, secrets);
  }
  return { targets, secrets };
}

/** Map an on-disk target + its secret entry to the wire form: presence flags
 *  only, never the encrypted credential. */
function toWireTarget(t: StoredTarget, secret: TargetSecret | undefined): PublishTarget {
  if (t.kind === 's3') return { ...t, hasSecret: !!secret?.s3Secret };
  return { ...t, hasToken: !!secret?.githubToken };
}

/** All configured publish targets (#254, #1444), secrets stripped. Empty when unset. */
export function getPublishTargets(rootPath: string): PublishTarget[] {
  const { targets, secrets } = loadPublishState(rootPath);
  return targets.map((t) => toWireTarget(t, secrets[t.id]));
}

export function getPublishTarget(rootPath: string, id: string): PublishTarget | null {
  return getPublishTargets(rootPath).find((t) => t.id === id) ?? null;
}

/**
 * Decrypted S3 credentials for a target (#1444) — main-only, for the transport
 * at publish time. Never crosses to the renderer. Empty for non-S3 / unknown ids.
 */
export function getS3Credentials(rootPath: string, id: string): { accessKeyId?: string; secretAccessKey?: string } {
  const { targets, secrets } = loadPublishState(rootPath);
  const t = targets.find((x) => x.id === id);
  if (!t || t.kind !== 's3') return {};
  const enc = secrets[id]?.s3Secret;
  return {
    ...(t.accessKeyId ? { accessKeyId: t.accessKeyId } : {}),
    ...(enc ? { secretAccessKey: decryptSecret(enc) } : {}),
  };
}

/**
 * The decrypted GitHub token for a git target (#1508) — main-only, for the
 * push. Empty for non-git / unknown ids or when no token is stored (the
 * `gh` CLI / env fallback then applies).
 */
export function getGitCredentials(rootPath: string, id: string): { token?: string } {
  const { targets, secrets } = loadPublishState(rootPath);
  const t = targets.find((x) => x.id === id);
  if (!t || t.kind === 's3') return {};
  const enc = secrets[id]?.githubToken;
  return enc ? { token: decryptSecret(enc) } : {};
}

/** Wire → on-disk config form: drop the write-only secret + its presence flag. */
function toStoredTarget(target: PublishTarget): StoredTarget {
  if (target.kind === 's3') {
    const { secretAccessKey: _s, hasSecret: _h, ...rest } = target;
    return rest;
  }
  const { githubToken: _t, hasToken: _ht, ...rest } = target;
  return rest;
}

/** Apply a wire target's tri-state secret onto its secret entry: a string sets
 *  (encrypted), '' clears, omitted keeps the stored value. Returns undefined
 *  when nothing remains, so the entry can be dropped. */
function applySecret(prev: TargetSecret | undefined, target: PublishTarget): TargetSecret | undefined {
  const cur: TargetSecret = { ...(prev ?? {}) };
  const field: keyof TargetSecret = target.kind === 's3' ? 's3Secret' : 'githubToken';
  const value = target.kind === 's3' ? target.secretAccessKey : target.githubToken;
  if (value === '') delete cur[field];
  else if (value !== undefined) cur[field] = encryptSecret(value);
  return Object.keys(cur).length > 0 ? cur : undefined;
}

/** Insert or replace a target by id, preserving the rest of the list and other
 *  targets' secrets. Non-secret fields → config.json; the credential → secrets.json. */
export function upsertPublishTarget(rootPath: string, target: PublishTarget): void {
  const { targets, secrets } = loadPublishState(rootPath);
  const stored = toStoredTarget(target);
  const idx = targets.findIndex((t) => t.id === target.id);
  if (idx >= 0) targets[idx] = stored;
  else targets.push(stored);
  const secret = applySecret(secrets[target.id], target);
  if (secret) secrets[target.id] = secret;
  else delete secrets[target.id];
  patchProjectConfig(rootPath, { publish: { targets } });
  writeSecrets(rootPath, secrets);
}

export function removePublishTarget(rootPath: string, id: string): void {
  const { targets, secrets } = loadPublishState(rootPath);
  const next = targets.filter((t) => t.id !== id);
  delete secrets[id];
  patchProjectConfig(rootPath, { publish: { targets: next } });
  writeSecrets(rootPath, secrets);
}
