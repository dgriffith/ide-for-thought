/**
 * @vitest-environment happy-dom
 *
 * Render coverage for AiSettings (#672) — the model / API-key / tool-override
 * panel extracted from SettingsDialog. The dialog owns persistence (save-on-
 * Done) and binds the state in; this pins the presentational behavior: the API-
 * key status states + the clear/cancel toggle, the model select, and the tool-
 * override table (getAllToolInfos mocked; modelLabel runs for real).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

const { getAllToolInfosMock } = vi.hoisted(() => ({ getAllToolInfosMock: vi.fn() }));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({
  getAllToolInfos: getAllToolInfosMock,
}));

import AiSettings from '../../../src/renderer/lib/components/AiSettings.svelte';

function props(over: Partial<{
  model: string; apiKeyInput: string; clearApiKey: boolean;
  toolModelOverrides: Record<string, string>; apiKeyStatus: 'unknown' | 'set' | 'unset';
}> = {}) {
  return {
    model: 'claude-sonnet-4-6',
    apiKeyInput: '',
    clearApiKey: false,
    toolModelOverrides: {},
    apiKeyStatus: 'set' as const,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  getAllToolInfosMock.mockReset();
});

describe('AiSettings (#672)', () => {
  it('renders the API-key status for each state', () => {
    getAllToolInfosMock.mockReturnValue([]);
    expect(render(AiSettings, props({ apiKeyStatus: 'set' })).getByText('✓ API key saved')).toBeTruthy();
    cleanup();
    expect(render(AiSettings, props({ apiKeyStatus: 'unset' })).getByText('No API key set')).toBeTruthy();
    cleanup();
    expect(render(AiSettings, props({ apiKeyStatus: 'unknown' })).getByText('Loading…')).toBeTruthy();
  });

  it('Clear saved key flips to the cleared state and disables the input; Cancel clear restores it', async () => {
    getAllToolInfosMock.mockReturnValue([]);
    const { getByText, getByLabelText, queryByText } = render(AiSettings, props({ apiKeyStatus: 'set' }));

    await fireEvent.click(getByText('Clear saved key'));
    expect(getByText('API key will be cleared on save')).toBeTruthy();
    expect((getByLabelText('Anthropic API key') as HTMLInputElement).disabled).toBe(true);
    expect(queryByText('✓ API key saved')).toBeNull();

    await fireEvent.click(getByText('Cancel clear'));
    expect(getByText('✓ API key saved')).toBeTruthy();
  });

  it('renders the tool-override table with each tool, its preference, and an override select', () => {
    getAllToolInfosMock.mockReturnValue([
      { id: 'summarize', name: 'Summarize', preferredModel: 'claude-haiku-4-5-20251001' },
      { id: 'analyze', name: 'Analyze', preferredModel: undefined },
    ]);
    const { getByText, getAllByRole } = render(AiSettings, props());
    expect(getByText('Summarize')).toBeTruthy();
    expect(getByText('Analyze')).toBeTruthy();
    // No-preference tool shows the em-dash.
    expect(getByText('—')).toBeTruthy();
    // model select + one override select per tool.
    expect(getAllByRole('combobox').length).toBe(3);
  });

  it('shows the empty state when no tools are registered', () => {
    getAllToolInfosMock.mockReturnValue([]);
    expect(render(AiSettings, props()).getByText('No tools registered.')).toBeTruthy();
  });

  it('changing a tool override updates that select to the chosen model', async () => {
    getAllToolInfosMock.mockReturnValue([
      { id: 'summarize', name: 'Summarize', preferredModel: undefined },
    ]);
    const { getAllByRole } = render(AiSettings, props());
    // [0] = default-model select, [1] = the tool override select.
    const overrideSelect = getAllByRole('combobox')[1] as HTMLSelectElement;
    expect(overrideSelect.value).toBe(''); // "Use tool preference"

    await fireEvent.change(overrideSelect, { target: { value: 'claude-opus-4-7' } });
    expect(overrideSelect.value).toBe('claude-opus-4-7');
  });
});
