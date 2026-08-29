/**
 * `loadUIState` config-loader migration (#1913). The multi-project test
 * (`conversation-multi-project.test.ts`) covers the happy path and the
 * missing-file default; this pins the corruption + per-field-fallback
 * behavior the migration to `loadConfigFile` was specifically about.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_UI_STATE, loadUIState } from '../../../src/main/llm/conversation';

function mkTempProject(): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), 'minerva-conv-ui-state-'));
}

const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => consoleErrorSpy.mockClear());

async function writeUiState(root: string, contents: string): Promise<void> {
  const dir = path.join(root, '.minerva', 'conversations');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '_ui.json'), contents, 'utf-8');
}

describe('loadUIState (#1913)', () => {
  it('reports and falls back to defaults for a corrupt file, instead of silently defaulting', async () => {
    const root = mkTempProject();
    await writeUiState(root, '{ not valid json');

    expect(await loadUIState(root)).toEqual(DEFAULT_UI_STATE);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('[config] failed to');

    await fs.rm(root, { recursive: true, force: true });
  });

  it('falls back to the default height for a non-positive value, matching the old typeof ladder', async () => {
    const root = mkTempProject();
    await writeUiState(root, JSON.stringify({ visible: true, height: 0, activeTabId: 'x' }));

    expect(await loadUIState(root)).toEqual({ visible: true, height: DEFAULT_UI_STATE.height, activeTabId: 'x' });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('falls back to null for a non-string activeTabId', async () => {
    const root = mkTempProject();
    await writeUiState(root, JSON.stringify({ visible: false, height: 400, activeTabId: 42 }));

    expect(await loadUIState(root)).toEqual({ visible: false, height: 400, activeTabId: null });

    await fs.rm(root, { recursive: true, force: true });
  });
});
