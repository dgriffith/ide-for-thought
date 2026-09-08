/**
 * The typed `invoke()` wrapper runtime-validates the resolved payload against
 * the ChannelMap (#983). Under the test runner validation is FATAL (mirrors the
 * write guard), so a shape regression rejects the invoke promise here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted((): { result: unknown } => ({ result: undefined }));

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(() => Promise.resolve(h.result)),
  },
}));

import { ipcRenderer } from 'electron';
import { invoke } from '../../src/preload/typed-invoke';
import { Channels } from '../../src/shared/channels';

const mockedInvoke = ipcRenderer.invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.result = undefined;
});

describe('invoke() payload validation (#983)', () => {
  it('passes a well-shaped payload straight through', async () => {
    h.result = [{ name: 'a.md', relativePath: 'a.md', isDirectory: false }];
    await expect(invoke(Channels.NOTEBASE_LIST_FILES)).resolves.toEqual(h.result);
  });

  it('rejects (fatal under test) when main returns the wrong shape', async () => {
    h.result = { not: 'an array' };
    await expect(invoke(Channels.NOTEBASE_LIST_FILES)).rejects.toThrow(/failed runtime validation/);
  });

  it('rejects a primitive-typed channel returning the wrong primitive', async () => {
    h.result = 123; // readFile must be a string
    await expect(invoke(Channels.NOTEBASE_READ_FILE, 'a.md')).rejects.toThrow(/failed runtime validation/);
  });

  it('does not validate void channels (no guard, passes through)', async () => {
    h.result = undefined;
    await expect(invoke(Channels.NOTEBASE_WRITE_FILE, 'a.md', 'x')).resolves.toBeUndefined();
  });
});

describe('invoke() de-proxies args before crossing IPC (#2094)', () => {
  it('rebuilds a Proxy-wrapped object/array arg into a plain equivalent', async () => {
    h.result = undefined;
    // Mimics a Svelte 5 `$state` reactive Proxy — a Proxy-wrapped object whose
    // nested array holds a Proxy-wrapped object in turn, the shape that
    // crashes Electron's structured clone if forwarded as-is (a bare Proxy
    // fails `structuredClone` even though the real DevTools error only
    // surfaces via the real ipcRenderer, not this mock).
    const update = new Proxy(
      { model: 'x', customModels: new Proxy([new Proxy({ id: '1', label: 'One' }, {})], {}) },
      {},
    );

    await invoke(Channels.TOOL_SET_SETTINGS, update as unknown as { model: string });

    const sentArg = mockedInvoke.mock.calls.at(-1)![1];
    expect(sentArg).toEqual({ model: 'x', customModels: [{ id: '1', label: 'One' }] });
    // The point of the fix: the value actually sent survives structured
    // clone, unlike the live Proxy that was passed in.
    expect(() => structuredClone(sentArg)).not.toThrow();
    expect(() => structuredClone(update)).toThrow();
  });

  it('leaves a Uint8Array argument untouched (notebase:writeBinary)', async () => {
    h.result = undefined;
    const bytes = new Uint8Array([1, 2, 3]);

    await invoke(Channels.NOTEBASE_WRITE_BINARY, 'a.bin', bytes);

    const sentArgs = mockedInvoke.mock.calls.at(-1)!.slice(1);
    expect(sentArgs[1]).toBeInstanceOf(Uint8Array);
    expect(Array.from(sentArgs[1] as Uint8Array)).toEqual([1, 2, 3]);
  });
});
