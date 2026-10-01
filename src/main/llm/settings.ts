import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  LLMSettings,
  LLMSettingsView,
  LLMSettingsUpdate,
  WebSettings,
  ApiKeyStorage,
  ProviderCredentials,
  ProviderCredentialsUpdate,
  ProviderConfigView,
  CustomModel,
} from '../../shared/tools/types';
import { DEFAULT_WEB_SETTINGS } from '../../shared/tools/types';
import { isEffort, type Effort } from '../../shared/tools/effort';
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from '../../shared/tools/providers';
import { providerForModel, DEFAULT_MODEL } from '../../shared/tools/models';
import { encryptSecret, decryptSecret, isEncrypted, secretEncryptionAvailable } from '../secret-storage';
import { reportConfigError } from '../config/config-store';
import { writeJsonFileAtomic } from '../config/json-file';

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
 * Validate the persisted user-defined local models (BYOM #1497). Keeps only
 * entries with a non-empty string id, dedupes by id (first wins), and returns
 * undefined when none remain so the field stays omitted.
 */
function resolveCustomModels(stored: unknown): CustomModel[] | undefined {
  if (!Array.isArray(stored)) return undefined;
  const out: CustomModel[] = [];
  const seen = new Set<string>();
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, label } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, ...(typeof label === 'string' && label.trim() ? { label } : {}) });
  }
  return out.length > 0 ? out : undefined;
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

// ── Provider credentials (BYOM #1492) ────────────────────────────────────────

/** Raw stored credentials — `apiKey` is the on-disk form (encrypted or legacy
 *  plaintext), NOT decrypted. */
type StoredCreds = { apiKey?: string; baseURL?: string };

/** The on-disk settings shape, tolerant of both the legacy single-`apiKey`
 *  layout and the new per-provider `providers` map. */
interface StoredSettings {
  apiKey?: unknown;
  providers?: unknown;
  customModels?: unknown;
  model?: unknown;
  web?: unknown;
  effort?: unknown;
  toolModelOverrides?: unknown;
  autoTitleConversations?: unknown;
}

/**
 * STRICT read, for the read-modify-write paths (#2356). A missing file reads as
 * `{}` — nothing saved yet, not an error. Anything else — an unreadable file
 * (EACCES), malformed JSON, or JSON that isn't an object — is reported through
 * `reportConfigError` and then RETHROWN.
 *
 * This used to be the only reader and it swallowed every failure as `{}`.
 * `saveSettings` then built its write from that `{}`, so a corrupt file (which
 * the old non-atomic `writeFile` could itself produce on a crash) became a file
 * holding only the fields of the one update being saved: every stored provider
 * API key gone. Same shape and same fix as `readRawProjectConfig` (#1891,
 * #1913) — and for the same reason it deliberately does not go through
 * `loadConfigFile`, whose contract is never-throw.
 */
async function readParsedStrict(): Promise<StoredSettings> {
  const file = settingsPath();
  let text: string;
  try {
    text = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    reportConfigError(file, 'read', err);
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    reportConfigError(file, 'parse', err);
    throw err;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const err = new Error('settings file is not a JSON object');
    reportConfigError(file, 'validate', err);
    throw err;
  }
  return raw;
}

/**
 * LENIENT read, for the display / call paths. Same as the strict read, except a
 * failure (already reported by it) reads as `{}` — the settings panel still
 * opens, and a model call reports "no API key" rather than crashing. Never use
 * this to build a write: that is the clobber #2356 fixed.
 */
async function readParsedLenient(): Promise<StoredSettings> {
  try {
    return await readParsedStrict();
  } catch {
    return {};
  }
}

/**
 * The raw stored per-provider credentials, applying the legacy migration: a
 * pre-BYOM top-level `apiKey` string is read as `providers.anthropic.apiKey`.
 * Values are left in their on-disk (possibly-encrypted) form.
 */
function storedProviders(parsed: StoredSettings): Partial<Record<ProviderId, StoredCreds>> {
  const out: Partial<Record<ProviderId, StoredCreds>> = {};
  if (parsed.providers && typeof parsed.providers === 'object') {
    const map = parsed.providers as Record<string, unknown>;
    for (const id of PROVIDER_IDS) {
      const c = map[id];
      if (!c || typeof c !== 'object') continue;
      const { apiKey, baseURL } = c as Record<string, unknown>;
      const creds: StoredCreds = {};
      if (typeof apiKey === 'string') creds.apiKey = apiKey;
      if (typeof baseURL === 'string' && baseURL.trim()) creds.baseURL = baseURL.trim();
      if (Object.keys(creds).length > 0) out[id] = creds;
    }
    return out;
  }
  // Legacy: a top-level string apiKey migrates to the Anthropic slot. Only when
  // it's a string (even '') — an absent key leaves the slot empty so the env
  // fallback still applies.
  if (typeof parsed.apiKey === 'string') out.anthropic = { apiKey: parsed.apiKey };
  return out;
}

function envKeyFor(id: ProviderId): string | undefined {
  const name = PROVIDERS[id].envVar;
  return name ? (process.env[name] || undefined) : undefined;
}

/** Decrypt every provider's key for the call path, folding in the env var as a
 *  fallback only when no key field is stored (an explicitly-cleared '' stays
 *  cleared, matching the pre-BYOM `?? env` semantics). */
function decryptProviders(stored: Partial<Record<ProviderId, StoredCreds>>): Partial<Record<ProviderId, ProviderCredentials>> {
  const out: Partial<Record<ProviderId, ProviderCredentials>> = {};
  for (const id of PROVIDER_IDS) {
    const s = stored[id];
    const apiKey = s && typeof s.apiKey === 'string' ? decryptSecret(s.apiKey) : envKeyFor(id);
    const creds: ProviderCredentials = {};
    if (apiKey) creds.apiKey = apiKey;
    if (s?.baseURL) creds.baseURL = s.baseURL;
    if (Object.keys(creds).length > 0) out[id] = creds;
  }
  return out;
}

/** Display-only per-provider status (no decrypt). */
function providerViews(stored: Partial<Record<ProviderId, StoredCreds>>): Partial<Record<ProviderId, ProviderConfigView>> {
  const out: Partial<Record<ProviderId, ProviderConfigView>> = {};
  for (const id of PROVIDER_IDS) {
    const s = stored[id];
    const hasStoredKey = !!(s && typeof s.apiKey === 'string' && s.apiKey.length > 0);
    // Env fallback only counts when no key field is stored for this provider.
    const hasEnvKey = s && typeof s.apiKey === 'string' ? false : !!envKeyFor(id);
    const meta = PROVIDERS[id];
    const hasApiKey = meta.requiresKey ? (hasStoredKey || hasEnvKey) : !!s?.baseURL;
    const view: ProviderConfigView = { hasApiKey, keyStored: hasStoredKey || hasEnvKey };
    if (s?.baseURL) view.baseURL = s.baseURL;
    out[id] = view;
  }
  return out;
}

/**
 * Lazily upgrade any legacy plaintext provider key to encrypted-at-rest the
 * first time settings are read on a machine where encryption is available
 * (#1642) — instead of waiting for that specific provider to be edited. Also
 * folds a pre-BYOM top-level `apiKey` into the `providers` map. Self-heals after
 * one write; a no-op when secure storage is unavailable or every stored key is
 * already encrypted.
 */
async function reencryptLegacyProviderKeys(parsed: StoredSettings): Promise<void> {
  if (!secretEncryptionAvailable()) return;
  const stored = storedProviders(parsed);
  const providers: Partial<Record<ProviderId, StoredCreds>> = {};
  let changed = false;
  for (const id of PROVIDER_IDS) {
    const c = stored[id];
    if (!c || Object.keys(c).length === 0) continue;
    if (typeof c.apiKey === 'string' && c.apiKey.length > 0 && !isEncrypted(c.apiKey)) {
      providers[id] = { ...c, apiKey: encryptSecret(c.apiKey) };
      changed = true;
    } else {
      providers[id] = c;
    }
  }
  if (!changed) return;
  // Drop the legacy top-level `apiKey` (now folded into providers) and persist.
  const { apiKey: _legacyApiKey, ...restParsed } = parsed;
  const onDisk = { ...restParsed, providers };
  await writeJsonFileAtomic(settingsPath(), onDisk);
}

export async function getSettings(): Promise<LLMSettings> {
  // Lenient: a corrupt file reads as `{}`, which has no legacy keys to upgrade,
  // so the re-encryption write below never fires over a file it couldn't parse.
  const parsed = await readParsedLenient();
  await reencryptLegacyProviderKeys(parsed);
  const effort = resolveEffortSetting(parsed.effort);
  const toolModelOverrides = resolveToolModelOverrides(parsed.toolModelOverrides);
  const customModels = resolveCustomModels(parsed.customModels);
  return {
    providers: decryptProviders(storedProviders(parsed)),
    model: resolveModel(parsed.model),
    web: resolveWeb(parsed.web),
    ...(effort ? { effort } : {}),
    ...(toolModelOverrides ? { toolModelOverrides } : {}),
    ...(parsed.autoTitleConversations === false ? { autoTitleConversations: false } : {}),
    ...(customModels ? { customModels } : {}),
  };
}

/**
 * Display-only settings for the settings panel / model picker. Same as
 * `getSettings` but WITHOUT decrypting any API key — reading settings to show
 * the model, effort, or a set/unset badge must never prompt the OS keychain.
 * The plaintext key is only ever materialized by the API-call path
 * (`getSettings`). `hasApiKey` reports whether the ACTIVE model's provider has a
 * usable key; `providers` carries the per-provider detail for the BYOM UI.
 */
export async function getSettingsForDisplay(): Promise<LLMSettingsView> {
  const parsed = await readParsedLenient();
  const effort = resolveEffortSetting(parsed.effort);
  const toolModelOverrides = resolveToolModelOverrides(parsed.toolModelOverrides);
  const model = resolveModel(parsed.model);
  const providers = providerViews(storedProviders(parsed));
  const customModels = resolveCustomModels(parsed.customModels);
  const activeProvider = providerForModel(model) ?? 'anthropic';
  const hasApiKey = providers[activeProvider]?.hasApiKey ?? false;
  return {
    model,
    web: resolveWeb(parsed.web),
    ...(effort ? { effort } : {}),
    ...(toolModelOverrides ? { toolModelOverrides } : {}),
    ...(parsed.autoTitleConversations === false ? { autoTitleConversations: false } : {}),
    hasApiKey,
    providers,
    ...(customModels ? { customModels } : {}),
  };
}

/** Apply a tri-state credential update to a provider's stored form: a string
 *  sets the field (apiKey encrypted), `''` clears it (kept as an empty field so
 *  it suppresses the env fallback, matching the legacy clear semantics), and an
 *  omitted field preserves the stored value verbatim. */
function applyCredsUpdate(existing: StoredCreds | undefined, u: ProviderCredentialsUpdate): StoredCreds {
  const out: StoredCreds = { ...(existing ?? {}) };
  if (u.apiKey !== undefined) out.apiKey = u.apiKey === '' ? '' : encryptSecret(u.apiKey);
  if (u.baseURL !== undefined) {
    const trimmed = u.baseURL.trim();
    if (trimmed) out.baseURL = trimmed;
    else delete out.baseURL;
  }
  return out;
}

export async function saveSettings(update: LLMSettingsUpdate): Promise<void> {
  const { apiKey: legacyKey, providers: providerUpdates, customModels: customModelsUpdate, ...rest } = update;
  // Strict: a corrupt/unreadable file THROWS here rather than reading as `{}`
  // and being overwritten with only this update's fields (#2356).
  const parsed = await readParsedStrict();
  const existing = storedProviders(parsed);
  const next: Partial<Record<ProviderId, StoredCreds>> = { ...existing };

  if (providerUpdates) {
    for (const id of PROVIDER_IDS) {
      const u = providerUpdates[id];
      if (u) next[id] = applyCredsUpdate(existing[id], u);
    }
  }
  // Legacy single-key path (current single-provider UI) → Anthropic slot.
  if (legacyKey !== undefined) {
    next.anthropic = applyCredsUpdate(next.anthropic, { apiKey: legacyKey });
  }

  const providers: Partial<Record<ProviderId, StoredCreds>> = {};
  for (const id of PROVIDER_IDS) {
    const c = next[id];
    if (c && Object.keys(c).length > 0) providers[id] = c;
  }

  // customModels is a full-replacement tri-state: omitted ⇒ preserve the stored
  // list; provided (incl. []) ⇒ validate + replace.
  const customModels = customModelsUpdate === undefined
    ? resolveCustomModels(parsed.customModels)
    : resolveCustomModels(customModelsUpdate);

  const onDisk = { ...rest, providers, ...(customModels ? { customModels } : {}) };
  await writeJsonFileAtomic(settingsPath(), onDisk);
}

/**
 * Report how a provider's stored API key is protected at rest, for the settings
 * UI (#1326). Defaults to Anthropic so the existing single-key IPC caller is
 * unchanged. `available` reflects the machine's secure-storage capability;
 * `encrypted` reflects the actual on-disk form of that provider's stored key (a
 * legacy plaintext key reads back `encrypted: false` until it's re-saved).
 */
export async function getApiKeyStorage(providerId: ProviderId = 'anthropic'): Promise<ApiKeyStorage> {
  // Lenient: no file (or an unreadable one, reported) — nothing encrypted.
  const raw = storedProviders(await readParsedLenient())[providerId]?.apiKey;
  const encrypted = typeof raw === 'string' && raw.length > 0 && isEncrypted(raw);
  return { available: secretEncryptionAvailable(), encrypted };
}
