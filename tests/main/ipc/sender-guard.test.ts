/**
 * IPC sender validation (#2553): only the renderer's own main frame may call
 * into main. Drives the real guard (the global setup mocks it for the
 * registrar tests) through the real `typed-ipc.handle()` wrapper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.unmock('../../../src/main/ipc/sender-guard');

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, ...a: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
}));

// The vite `define` globals: a packaged build (no dev server), whose entry
// is `<__dirname>/../renderer/main_window/index.html`.
vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window');

import { isTrustedIpcSender } from '../../../src/main/ipc/sender-guard';
import { handle } from '../../../src/main/ipc/typed-ipc';
import { rendererEntryUrl } from '../../../src/main/renderer-entry';
import { Channels } from '../../../src/shared/channels';

const ENTRY = rendererEntryUrl();

function event(url: string | null, opts: { subframe?: boolean } = {}) {
  const mainFrame = { url: url ?? '' };
  const senderFrame = url === null ? null : opts.subframe ? { url } : mainFrame;
  return { sender: { mainFrame }, senderFrame };
}

beforeEach(() => h.handlers.clear());

describe('isTrustedIpcSender (#2553)', () => {
  it('trusts the renderer entry\'s main frame, with or without a hash', () => {
    expect(ENTRY).toMatch(/^file:\/\/.*\/renderer\/main_window\/index\.html$/);
    expect(isTrustedIpcSender(event(ENTRY) as never)).toBe(true);
    expect(isTrustedIpcSender(event(`${ENTRY}#/notes/a.md`) as never)).toBe(true);
  });

  it('refuses a main frame showing any other file:// page', () => {
    expect(isTrustedIpcSender(event('file:///tmp/x.html') as never)).toBe(false);
    expect(isTrustedIpcSender(event('file:///Volumes/share/tb/evil.html') as never)).toBe(false);
    expect(isTrustedIpcSender(event('https://example.com/') as never)).toBe(false);
  });

  it('refuses a subframe even when its URL is the entry', () => {
    expect(isTrustedIpcSender(event(ENTRY, { subframe: true }) as never)).toBe(false);
  });

  it('refuses a destroyed or navigated-away frame (senderFrame null)', () => {
    expect(isTrustedIpcSender(event(null) as never)).toBe(false);
  });
});

describe('typed-ipc handle() enforces the sender check (#2553)', () => {
  it('runs the handler for the renderer and rejects anyone else before it runs', async () => {
    const impl = vi.fn(() => []);
    handle(Channels.APP_GET_SHORTCUTS, impl);
    const registered = h.handlers.get(Channels.APP_GET_SHORTCUTS)!;

    expect(await registered(event(ENTRY))).toEqual([]);
    expect(impl).toHaveBeenCalledTimes(1);

    expect(() => registered(event('file:///tmp/x.html'))).toThrow(/refused: the sender is not the Minerva renderer/);
    expect(() => registered(event(ENTRY, { subframe: true }))).toThrow(/refused/);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('passes the event and arguments through unchanged', () => {
    const impl = vi.fn((_e: unknown, ...a: unknown[]) => a);
    handle(Channels.APP_GET_SHORTCUTS, impl as never);
    const ev = event(ENTRY);
    h.handlers.get(Channels.APP_GET_SHORTCUTS)!(ev, 'a', 2);
    expect(impl).toHaveBeenCalledWith(ev, 'a', 2);
  });
});
