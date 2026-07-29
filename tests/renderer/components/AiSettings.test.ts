/**
 * @vitest-environment happy-dom
 *
 * Render coverage for AiSettings (BYOM #1498) — the multi-provider model / key
 * panel. SettingsDialog owns persistence (save-on-Done) and binds state in;
 * this pins the presentational behavior: per-provider key status + clear toggle,
 * the provider-grouped default-model select, the per-provider connection check,
 * and the local custom-model manager.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { ConnectionCheckResult, ProviderConfigView, CustomModel } from '../../../src/shared/tools/types';
import type { ProviderId } from '../../../src/shared/tools/providers';

import AiSettings from '../../../src/renderer/lib/components/AiSettings.svelte';

type Inputs = Record<ProviderId, { key: string; baseURL: string; clear: boolean }>;
function inputs(over: Partial<Inputs> = {}): Inputs {
  return {
    anthropic: { key: '', baseURL: '', clear: false },
    openai: { key: '', baseURL: '', clear: false },
    google: { key: '', baseURL: '', clear: false },
    local: { key: '', baseURL: '', clear: false },
    ...over,
  };
}

function props(over: Record<string, unknown> = {}) {
  return {
    model: 'claude-sonnet-4-6',
    effort: undefined,
    providerInputs: inputs(),
    providerViews: { anthropic: { hasApiKey: true } } as Partial<Record<ProviderId, ProviderConfigView>>,
    secureStorageAvailable: true,
    customModels: [] as CustomModel[],
    onCheckConnection: vi.fn(async (): Promise<ConnectionCheckResult> => ({ ok: true })),
    ...over,
  };
}

afterEach(() => cleanup());

describe('AiSettings (BYOM #1498)', () => {
  it('shows per-provider key status: encrypted for the configured one, unset for the rest', () => {
    const { getByText, getAllByText } = render(AiSettings, props());
    expect(getByText('🔒 API key saved — encrypted at rest')).toBeTruthy(); // anthropic (secure store on)
    expect(getAllByText('No API key set').length).toBe(2); // openai + google unconfigured
  });

  it('drops the "encrypted" claim when secure storage is unavailable', () => {
    const { getByText } = render(AiSettings, props({ secureStorageAvailable: false }));
    expect(getByText('✓ API key saved')).toBeTruthy();
  });

  it('Clear saved key flips to the cleared state; Cancel clear restores it', async () => {
    const { getByText } = render(AiSettings, props());
    await fireEvent.click(getByText('Clear saved key'));
    expect(getByText('API key will be cleared on save')).toBeTruthy();
    await fireEvent.click(getByText('Cancel clear'));
    expect(getByText('🔒 API key saved — encrypted at rest')).toBeTruthy();
  });

  it('renders a provider-grouped default-model select with the bound value', () => {
    const { getByLabelText } = render(AiSettings, props());
    const select = getByLabelText('Default model') as HTMLSelectElement;
    expect(select.value).toBe('claude-sonnet-4-6');
    const groups = [...select.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toContain('Anthropic');
    expect(groups).toContain('OpenAI');
    expect(groups).toContain('Google Gemini');
  });

  it('the first (Anthropic) Check connection calls back with the provider id + typed key', async () => {
    const onCheckConnection = vi.fn(async (): Promise<ConnectionCheckResult> => ({ ok: true }));
    const { getAllByText, findByText } = render(
      AiSettings,
      props({ providerInputs: inputs({ anthropic: { key: 'sk-typed', baseURL: '', clear: false } }), onCheckConnection }),
    );
    await fireEvent.click(getAllByText('Check connection')[0]!);
    expect(onCheckConnection).toHaveBeenCalledWith('anthropic', 'sk-typed', '');
    await findByText(/Connected/);
  });

  it('adds and removes a local custom model, and surfaces it in the picker', async () => {
    const { getByPlaceholderText, getByText, getByLabelText, container } = render(AiSettings, props());
    await fireEvent.input(getByPlaceholderText('Model id (e.g. llama3.1)'), { target: { value: 'llama3.1' } });
    await fireEvent.click(getByText('Add'));
    // Shows in the managed list.
    expect(container.querySelector('.custom-model-name')?.textContent).toContain('llama3.1');
    // And under the local group in the default-model select.
    const select = getByLabelText('Default model') as HTMLSelectElement;
    expect([...select.querySelectorAll('option')].map((o) => o.value)).toContain('llama3.1');
    // Remove it.
    await fireEvent.click(getByText('Remove'));
    expect(container.querySelector('.custom-model-name')).toBeNull();
  });
});
