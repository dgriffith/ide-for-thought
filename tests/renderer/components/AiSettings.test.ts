/**
 * @vitest-environment happy-dom
 *
 * Render coverage for AiSettings (#672) — the model / API-key panel extracted
 * from SettingsDialog. The dialog owns persistence (save-on-Done) and binds the
 * state in; this pins the presentational behavior: the API-key status states +
 * the clear/cancel toggle, and the default-model select. (Per-skill model
 * overrides moved to SkillsSettings — see SkillsSettings.test.ts.)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

import AiSettings from '../../../src/renderer/lib/components/AiSettings.svelte';

function props(over: Partial<{
  model: string; apiKeyInput: string; clearApiKey: boolean;
  apiKeyStatus: 'unknown' | 'set' | 'unset';
}> = {}) {
  return {
    model: 'claude-sonnet-4-6',
    apiKeyInput: '',
    clearApiKey: false,
    apiKeyStatus: 'set' as const,
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

describe('AiSettings (#672)', () => {
  it('renders the API-key status for each state', () => {
    expect(render(AiSettings, props({ apiKeyStatus: 'set' })).getByText('✓ API key saved')).toBeTruthy();
    cleanup();
    expect(render(AiSettings, props({ apiKeyStatus: 'unset' })).getByText('No API key set')).toBeTruthy();
    cleanup();
    expect(render(AiSettings, props({ apiKeyStatus: 'unknown' })).getByText('Loading…')).toBeTruthy();
  });

  it('Clear saved key flips to the cleared state and disables the input; Cancel clear restores it', async () => {
    const { getByText, getByLabelText, queryByText } = render(AiSettings, props({ apiKeyStatus: 'set' }));

    await fireEvent.click(getByText('Clear saved key'));
    expect(getByText('API key will be cleared on save')).toBeTruthy();
    expect((getByLabelText('Anthropic API key') as HTMLInputElement).disabled).toBe(true);
    expect(queryByText('✓ API key saved')).toBeNull();

    await fireEvent.click(getByText('Cancel clear'));
    expect(getByText('✓ API key saved')).toBeTruthy();
  });

  it('renders the default-model select with the bound value', () => {
    const { getByLabelText } = render(AiSettings, props());
    expect((getByLabelText('Default model') as HTMLSelectElement).value).toBe('claude-sonnet-4-6');
  });
});
