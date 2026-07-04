import { describe, it, expect } from 'vitest';
import { CHANNEL_VALIDATORS } from '../../src/shared/ipc-validators';
import { Channels } from '../../src/shared/channels';

/**
 * Runtime IPC payload validators (#983). Each guard must accept the real return
 * shape for its channel and reject a plausible wrong-shaped payload (the
 * main-side-bug case). Array guards are shallow by design.
 */
describe('CHANNEL_VALIDATORS (#983)', () => {
  const meta = { rootPath: '/x', name: 'X' };
  const noteFile = { name: 'a.md', relativePath: 'a.md', isDirectory: false };

  it('open-family accepts NotebaseMeta or null, rejects junk', () => {
    const v = CHANNEL_VALIDATORS[Channels.NOTEBASE_OPEN]!;
    expect(v(meta)).toBe(true);
    expect(v(null)).toBe(true);
    expect(v({ rootPath: 1 })).toBe(false);
    expect(v('nope')).toBe(false);
  });

  it('openPath requires a real meta (null is NOT allowed)', () => {
    const v = CHANNEL_VALIDATORS[Channels.NOTEBASE_OPEN_PATH]!;
    expect(v(meta)).toBe(true);
    expect(v(null)).toBe(false);
  });

  it('listFiles shallow-checks NoteFile[]', () => {
    const v = CHANNEL_VALIDATORS[Channels.NOTEBASE_LIST_FILES]!;
    expect(v([])).toBe(true);
    expect(v([noteFile])).toBe(true);
    expect(v([{ name: 'a' }])).toBe(false); // missing relativePath/isDirectory
    expect(v('notarray')).toBe(false);
  });

  it('readFile/fileExists check primitives', () => {
    expect(CHANNEL_VALIDATORS[Channels.NOTEBASE_READ_FILE]!('hi')).toBe(true);
    expect(CHANNEL_VALIDATORS[Channels.NOTEBASE_READ_FILE]!(42)).toBe(false);
    expect(CHANNEL_VALIDATORS[Channels.NOTEBASE_FILE_EXISTS]!(true)).toBe(true);
    expect(CHANNEL_VALIDATORS[Channels.NOTEBASE_FILE_EXISTS]!('true')).toBe(false);
  });

  it('readBinary requires a Uint8Array', () => {
    const v = CHANNEL_VALIDATORS[Channels.NOTEBASE_READ_BINARY]!;
    expect(v(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(v([1, 2, 3])).toBe(false);
  });

  it('merge validates the full result shape', () => {
    const v = CHANNEL_VALIDATORS[Channels.NOTEBASE_MERGE]!;
    expect(v({ targetPath: 't', mergeOffset: 0, mergeLine: 1, rewrittenLinks: 2, rewrittenPaths: ['a'], deletedSource: 's' })).toBe(true);
    expect(v({ targetPath: 't', mergeOffset: 0 })).toBe(false); // missing fields
  });

  it('rename-family checks { rewrittenPaths }', () => {
    const v = CHANNEL_VALIDATORS[Channels.NOTEBASE_RENAME_SOURCE]!;
    expect(v({ rewrittenPaths: ['a', 'b'] })).toBe(true);
    expect(v({ rewrittenPaths: [1] })).toBe(false);
    expect(v({})).toBe(false);
  });

  it('void channels have no validator', () => {
    expect(CHANNEL_VALIDATORS[Channels.NOTEBASE_WRITE_FILE]).toBeUndefined();
    expect(CHANNEL_VALIDATORS[Channels.RECENT_CLEAR]).toBeUndefined();
  });
});
