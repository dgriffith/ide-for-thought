import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { LLMSettings, LLMSettingsView, LLMSettingsUpdate, WebSettings, ApiKeyStorage } from '../../shared/tools/types';
import { DEFAULT_WEB_SETTINGS } from '../../shared/tools/types';
import { isEffort, type Effort } from '../../shared/tools/effort';
import { encryptSecret, decryptSecret, isEncrypted, secretEncryptionAvailable } from '../secret-storage';

const DEFAULT_MODEL = 'claude-opus-5';

const DEPRECATED_MODELS = new Set<string>([
  'claude-sonnet-4-20250514',
]);
// Note: neither claude-sonnet-4-6 nor claude-opus-4-8 is deprecated — both are
// still active and remain in the picker, so a user who explicitly selected one
// keeps it. Only the default for fresh installs / unset configs moves to Opus 5.

function resolveModel(stored: unknown): string {
  if (typeof stored !== 'string' || !stored) return DEFAULT_MODEL;
  if (DEPRECATED_MODELS.has(stored)) return DEFAULT_MODEL;
  return stored;
}

function resolveWeb(stored: unknown): WebSettings {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_WEB_SETTINGS };
  const s = stored as Partial<WebSettings>;
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_WEB_SETTINGS.enabled,
    allowedDomains: Array.isArray(s.allowedDomains) ? s.allowedDomains.filter(d => typeof d === 'string' && d.trim()) : [],
    blockedDomains: Array.isArray(s.blockedDomains) ? s.blockedDomains.filter(d => typeof d === 'string' && d.trim()) : [],
  };
}

function resolveEffortSetting(stored: unknown): Effort | undefined {
  return isEffort(stored) ? stored : undefined;
}

/**
 * Validate the persisted per-skill model override map (skill id → model id).
 * Returns undefined when absent/empty so the field stays omitted, matching the
 * optional shape. Without this, a saved override is written to disk but never
 * read back — so it silently never applies (in the UI *or* at runtime).
 */
function resolveToolModelOverrides(stored: unknown): Record<string, string> | undefined {
  if (!stored || typeof stored !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [id, model] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof model === 'string' && model) out[id] = model;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'llm-settings.json');
}

export async function getSettings(): Promise<LLMSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LLMSettings>;
    const effort = resolveEffortSetting(parsed.effort);
    // Decrypt the stored key (#1326). `decryptSecret` passes a legacy
    // plaintext value through unchanged, so pre-encryption configs keep
    // working. Only fall back to the env var when the field is absent —
    // an explicitly-cleared ('') key stays cleared, matching the prior
    // `?? env ?? ''` semantics.
    const apiKey = typeof parsed.apiKey === 'string'
      ? decryptSecret(parsed.apiKey)
      : (process.env.ANTHROPIC_API_KEY ?? '');
    const toolModelOverrides = resolveToolModelOverrides(parsed.toolModelOverrides);
    return {
      apiKey,
      model: resolveModel(parsed.model),
      web: resolveWeb(parsed.web),
      ...(effort ? { effort } : {}),
      ...(toolModelOverrides ? { toolModelOverrides } : {}),
    };
  } catch {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: DEFAULT_MODEL,
      web: { ...DEFAULT_WEB_SETTINGS },
    };
  }
}

/**
 * Display-only settings for the settings panel / model picker. Same as
 * `getSettings` but WITHOUT decrypting the API key — reading settings to show
 * the model, effort, or a set/unset badge must never prompt the OS keychain.
 * The plaintext key is only ever materialized by the API-call path
 * (`getSettings`). `hasApiKey` reports whether a key is configured (stored, or
 * via the env var) using the raw stored value — no decrypt.
 */
export async function getSettingsForDisplay(): Promise<LLMSettingsView> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LLMSettings>;
    const effort = resolveEffortSetting(parsed.effort);
    const hasApiKey = typeof parsed.apiKey === 'string'
      ? parsed.apiKey.length > 0
      : !!process.env.ANTHROPIC_API_KEY;
    const toolModelOverrides = resolveToolModelOverrides(parsed.toolModelOverrides);
    return {
      model: resolveModel(parsed.model),
      web: resolveWeb(parsed.web),
      ...(effort ? { effort } : {}),
      ...(toolModelOverrides ? { toolModelOverrides } : {}),
      hasApiKey,
    };
  } catch {
    return {
      model: DEFAULT_MODEL,
      web: { ...DEFAULT_WEB_SETTINGS },
      hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    };
  }
}

/** Read the raw stored apiKey string (encrypted or legacy plaintext) without
 *  decrypting, so a save that doesn't touch the key can preserve it verbatim. */
async function readStoredApiKey(): Promise<string> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LLMSettings>;
    return typeof parsed.apiKey === 'string' ? parsed.apiKey : '';
  } catch {
    return '';
  }
}

export async function saveSettings(update: LLMSettingsUpdate): Promise<void> {
  // apiKey is tri-state (#1326): a provided string is encrypted at rest (''
  // clears); an OMITTED apiKey preserves the stored value verbatim — no decrypt
  // and no re-encrypt, so saving unrelated settings never touches the keychain.
  const { apiKey: providedKey, ...rest } = update;
  const apiKey = providedKey === undefined
    ? await readStoredApiKey()
    : encryptSecret(providedKey);
  const onDisk = { ...rest, apiKey };
  await fs.writeFile(settingsPath(), JSON.stringify(onDisk, null, 2), 'utf-8');
}

/**
 * Report how the stored API key is protected at rest, for the settings UI
 * (#1326). `available` reflects the machine's secure-storage capability;
 * `encrypted` reflects the actual on-disk form of the currently-stored key
 * (a legacy plaintext key reads back `encrypted: false` until it's re-saved).
 */
export async function getApiKeyStorage(): Promise<ApiKeyStorage> {
  let encrypted = false;
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LLMSettings>;
    encrypted = typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0 && isEncrypted(parsed.apiKey);
  } catch {
    // No settings file yet — nothing stored, so nothing encrypted.
  }
  return { available: secretEncryptionAvailable(), encrypted };
}
