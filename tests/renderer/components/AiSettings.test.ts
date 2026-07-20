/**
 * @vitest-environment happy-dom
 *
 * Render coverage for AiSettings (#672) — the model / API-key panel extracted
 * from SettingsDialog. The dialog owns persistence (save-on-Done) and binds the
 * state in; this pins the presentational behavior: the API-key status states +
 * the clear/cancel toggle, and the default-model select. (Per-skill model
 * overrides moved to SkillsSettings — see SkillsSettings.test.ts.)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { ConnectionCheckResult } from '../../../src/shared/tools/types';

import AiSettings from '../../../src/renderer/lib/components/AiSettings.svelte';

function props(over: Partial<{
  model: string; apiKeyInput: string; clearApiKey: boolean;
  apiKeyStatus: 'unknown' | 'set' | 'unset';
  onCheckConnection: (candidateKey: string) => Promise<ConnectionCheckResult>;
}> = {}) {
  return {
    model: 'claude-sonnet-4-6',
    apiKeyInput: '',
    clearApiKey: false,
    apiKeyStatus: 'set' as const,
    onCheckConnection: vi.fn(async () => ({ ok: true })),
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

  it('Check connection calls back with the typed key and shows success', async () => {
    const onCheckConnection = vi.fn(async () => ({ ok: true }));
    const { getByText, findByText } = render(
      AiSettings,
      props({ apiKeyInput: 'sk-typed', apiKeyStatus: 'unset', onCheckConnection }),
    );
    await fireEvent.click(getByText('Check connection'));
    expect(onCheckConnection).toHaveBeenCalledWith('sk-typed');
    await findByText(/Connected/);
  });

  it('shows the failure reason returned by the check', async () => {
    const onCheckConnection = vi.fn(
      async (): Promise<ConnectionCheckResult> => ({ ok: false, error: 'Anthropic rejected this key' }),
    );
    const { getByText, findByText } = render(AiSettings, props({ apiKeyStatus: 'set', onCheckConnection }));
    await fireEvent.click(getByText('Check connection'));
    await findByText(/rejected this key/);
  });

  it('disables Check connection when there is neither a stored nor a typed key', () => {
    const { getByText } = render(AiSettings, props({ apiKeyStatus: 'unset', apiKeyInput: '' }));
    expect((getByText('Check connection') as HTMLButtonElement).disabled).toBe(true);
  });

  it('clears a stale result when the key text changes', async () => {
    const { getByText, getByLabelText, findByText, queryByText } = render(
      AiSettings, props({ apiKeyStatus: 'set' }),
    );
    await fireEvent.click(getByText('Check connection'));
    await findByText(/Connected/);
    await fireEvent.input(getByLabelText('Anthropic API key'), { target: { value: 'x' } });
    await waitFor(() => expect(queryByText(/Connected/)).toBeNull());
  });
});
