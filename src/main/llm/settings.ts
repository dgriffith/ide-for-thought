import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { LLMSettings, WebSettings } from '../../shared/tools/types';
import { DEFAULT_WEB_SETTINGS } from '../../shared/tools/types';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

const DEPRECATED_MODELS = new Set<string>([
  'claude-sonnet-4-20250514',
]);

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

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'llm-settings.json');
}

export async function getSettings(): Promise<LLMSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      apiKey: parsed.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
      model: resolveModel(parsed.model),
      web: resolveWeb(parsed.web),
    };
  } catch {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: DEFAULT_MODEL,
      web: { ...DEFAULT_WEB_SETTINGS },
    };
  }
}

export async function saveSettings(settings: LLMSettings): Promise<void> {
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}
