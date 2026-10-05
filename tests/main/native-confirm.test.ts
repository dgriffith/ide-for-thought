/**
 * Main's native confirm (#2568), and what counts as "opening runs it".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => ({ showMessageBox: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showMessageBox: h.showMessageBox }, BrowserWindow: class {} }));

import { confirmNative, clampDetail } from '../../src/main/native-confirm';

beforeEach(() => h.showMessageBox.mockReset());

describe('confirmNative (#2568)', () => {
  it('is a plain question with Confirm/Cancel, Cancel as the escape', async () => {
    h.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });
    await confirmNative(null, { message: 'Run it?', detail: 'x', confirmLabel: 'Run' });
    const opts = h.showMessageBox.mock.calls[0]![0] as Electron.MessageBoxOptions;
    expect(opts).toMatchObject({ type: 'question', buttons: ['Run', 'Cancel'], cancelId: 1 });
    expect(opts).not.toHaveProperty('checkboxLabel');
  });

  it('maps the answer; a checked box only counts with a yes', async () => {
    h.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: true });
    expect(await confirmNative(null, { message: 'm', detail: 'd', confirmLabel: 'OK', checkboxLabel: 'Trust' }))
      .toEqual({ confirmed: true, checked: true });
    h.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: true });
    expect(await confirmNative(null, { message: 'm', detail: 'd', confirmLabel: 'OK', checkboxLabel: 'Trust' }))
      .toEqual({ confirmed: false, checked: false });
  });

  it('is modal to a live window, and falls back to app-modal for a destroyed or missing one', async () => {
    h.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
    const live = { isDestroyed: () => false };
    await confirmNative(live as never, { message: 'm', detail: 'd', confirmLabel: 'OK' });
    expect(h.showMessageBox.mock.calls[0]![0]).toBe(live);
    await confirmNative({ isDestroyed: () => true } as never, { message: 'm', detail: 'd', confirmLabel: 'OK' });
    expect(typeof h.showMessageBox.mock.calls[1]![0]).toBe('object');
    expect(h.showMessageBox.mock.calls[1]).toHaveLength(1);
  });

  it('caps a very long detail and says how much is hidden', () => {
    const long = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const out = clampDetail(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toMatch(/more line\(s\) not shown/);
    expect(clampDetail('short')).toBe('short');
  });
});

describe('isLaunchable (#2568)', () => {
  it('flags app/script/installer types and executable files; documents are not', async () => {
    vi.doMock('electron', () => ({ shell: {}, dialog: {}, app: {} }));
    const { isLaunchable } = await import('../../src/main/ipc/register-shell');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-launchable-'));
    try {
      for (const name of ['a.command', 'b.app', 'c.sh', 'd.pkg', 'e.py', 'f.webloc']) {
        expect(isLaunchable(path.join(dir, name)), name).toBe(true);
      }
      for (const name of ['paper.pdf', 'pic.png', 'note.md', 'data.csv']) {
        fs.writeFileSync(path.join(dir, name), 'x');
        expect(isLaunchable(path.join(dir, name)), name).toBe(false);
      }
      if (process.platform !== 'win32') {
        const bin = path.join(dir, 'tool');
        fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
        expect(isLaunchable(bin)).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
