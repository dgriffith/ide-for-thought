import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture what settings.ts persists so we can assert the reset clears configs.
// Hoisted so the mocks exist when vi.mock's factory (also hoisted) runs.
const { saveSettings, loadSettings } = vi.hoisted(() => ({
  saveSettings: vi.fn().mockResolvedValue(undefined),
  loadSettings: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { formatter: { saveSettings, loadSettings } },
}));

import {
  setFormatSettings,
  getFormatSettings,
  resetFormatToHouseStyle,
  __resetFormatSettingsForTests,
} from '../../../src/renderer/lib/formatter/settings';

describe('resetFormatToHouseStyle (full reset)', () => {
  beforeEach(() => {
    __resetFormatSettingsForTests();
    saveSettings.mockClear();
  });

  it('clears both enable/disable overrides and per-rule config tuning', () => {
    setFormatSettings({
      enabled: { 'capitalize-headings': true, 'trailing-spaces': false },
      configs: { 'consecutive-blank-lines': { max: 3 } },
    });
    expect(getFormatSettings().enabled).not.toEqual({});
    expect(getFormatSettings().configs).not.toEqual({});

    const next = resetFormatToHouseStyle();

    expect(next.enabled).toEqual({});
    expect(next.configs).toEqual({});
    expect(getFormatSettings()).toEqual({ enabled: {}, configs: {} });
  });

  it('persists the fully-cleared settings via IPC', () => {
    setFormatSettings({ configs: { 'consecutive-blank-lines': { max: 3 } } });
    saveSettings.mockClear();

    resetFormatToHouseStyle();

    expect(saveSettings).toHaveBeenCalledWith({ enabled: {}, configs: {} });
  });
});
