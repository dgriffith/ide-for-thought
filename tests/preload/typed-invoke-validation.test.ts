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

import { invoke } from '../../src/preload/typed-invoke';
import { Channels } from '../../src/shared/channels';

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
