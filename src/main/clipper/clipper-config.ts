/**
 * Per-machine browser-clipper config (#791): whether the clipper is enabled
 * and the shared secret the loopback endpoint requires.
 *
 * Persisted under `app.getPath('userData')` (per machine, not per project),
 * mirroring `ingest-settings.ts`. Off by default — a fresh install opens no
 * port until the user enables the clipper in Settings. The secret is generated
 * lazily the first time one is needed and survives across runs so a paired
 * extension keeps working; "Regenerate" rotates it (invalidating the old
 * pairing code).
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export interface ClipperConfig {
  enabled: boolean;
  /** 64 hex chars, or '' before one has been issued. */
  secret: string;
}

export const DEFAULT_CLIPPER_CONFIG: ClipperConfig = {
  enabled: false,
  secret: '',
};

function configPath(): string {
  return path.join(app.getPath('userData'), 'clipper-config.json');
}

function newSecret(): string {
  return randomBytes(32).toString('hex');
}

export async function getClipperConfig(): Promise<ClipperConfig> {
  try {
    const raw = await fs.readFile(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ClipperConfig>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_CLIPPER_CONFIG.enabled,
      secret: typeof parsed.secret === 'string' ? parsed.secret : DEFAULT_CLIPPER_CONFIG.secret,
    };
  } catch {
    return { ...DEFAULT_CLIPPER_CONFIG };
  }
}

async function saveClipperConfig(config: ClipperConfig): Promise<void> {
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf-8');
}

/** Set the enable flag. Enabling issues a secret if none exists yet. */
export async function setClipperEnabled(enabled: boolean): Promise<ClipperConfig> {
  const config = await getClipperConfig();
  config.enabled = enabled;
  if (enabled && !config.secret) config.secret = newSecret();
  await saveClipperConfig(config);
  return config;
}

/** Rotate the secret, invalidating any existing pairing code. */
export async function regenerateClipperSecret(): Promise<ClipperConfig> {
  const config = await getClipperConfig();
  config.secret = newSecret();
  await saveClipperConfig(config);
  return config;
}

/** The current secret, generating + persisting one if the store is empty. */
export async function ensureClipperSecret(): Promise<string> {
  const config = await getClipperConfig();
  if (config.secret) return config.secret;
  config.secret = newSecret();
  await saveClipperConfig(config);
  return config.secret;
}
