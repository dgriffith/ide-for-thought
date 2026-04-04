import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { LLMSettings } from '../../shared/tools/types';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'llm-settings.json');
}

export async function getSettings(): Promise<LLMSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      apiKey: parsed.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
      model: parsed.model ?? DEFAULT_MODEL,
    };
  } catch {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: DEFAULT_MODEL,
    };
  }
}

export async function saveSettings(settings: LLMSettings): Promise<void> {
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}
