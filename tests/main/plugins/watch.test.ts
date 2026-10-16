/**
 * @vitest-environment node
 *
 * The plugins folder watcher (#2634): a burst of changes is one call, hidden
 * entries (an install's staging folder) are ignored, and it creates the
 * folder it watches.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGINS_WATCH_WARMUP_MS, watchPluginsDir } from '../../../src/main/plugins/watch';

let tmp: string;
let stop: (() => void) | null = null;
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-watch-'))); });
afterEach(() => {
  stop?.();
  stop = null;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('watchPluginsDir (#2634)', () => {
  it('creates the folder, and a burst of changes is one call', async () => {
    const dir = path.join(tmp, 'plugins');
    const onChange = vi.fn();
    // A debounce with room to spare: under a loaded test run, FSEvents can
    // spread one burst's events further apart than a tight one tolerates.
    stop = watchPluginsDir(dir, onChange, 200);
    expect(fs.existsSync(dir)).toBe(true);
    await settle(PLUGINS_WATCH_WARMUP_MS + 50);
    fs.mkdirSync(path.join(dir, 'lab'));
    fs.writeFileSync(path.join(dir, 'lab', 'plugin.json'), '{}');
    fs.writeFileSync(path.join(dir, 'lab', 'a.md'), 'x');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await settle(400);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('drops what macOS reports about the folder itself just after watching starts', async () => {
    const dir = path.join(tmp, 'plugins');
    const onChange = vi.fn();
    stop = watchPluginsDir(dir, onChange, 50);
    await settle(PLUGINS_WATCH_WARMUP_MS + 150);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores hidden entries — an install stages in one', async () => {
    const dir = path.join(tmp, 'plugins');
    const onChange = vi.fn();
    stop = watchPluginsDir(dir, onChange, 50);
    await settle(PLUGINS_WATCH_WARMUP_MS + 50);
    fs.mkdirSync(path.join(dir, '.install-123'));
    await settle(250);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a folder that can't be watched is no watcher, not a throw", () => {
    const file = path.join(tmp, 'file');
    fs.writeFileSync(file, 'x');
    expect(() => { stop = watchPluginsDir(path.join(file, 'plugins'), vi.fn()); }).not.toThrow();
  });
});
