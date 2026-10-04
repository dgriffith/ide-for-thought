import { describe, it, expect } from 'vitest';
import { safetyMessageParts } from '../../src/shared/compute/safety';

describe('safetyMessageParts (#2563)', () => {
  it('splits backtick runs into code parts', () => {
    expect(safetyMessageParts('Imports `socket`')).toEqual([{ text: 'Imports ', code: false }, { text: 'socket', code: true }]);
    expect(safetyMessageParts('Calls `.write_text()` / `.write_bytes()`')).toEqual([
      { text: 'Calls ', code: false }, { text: '.write_text()', code: true }, { text: ' / ', code: false }, { text: '.write_bytes()', code: true },
    ]);
    expect(safetyMessageParts('Opens a file for writing')).toEqual([{ text: 'Opens a file for writing', code: false }]);
  });
});
