/**
 * @vitest-environment node
 *
 * The CLI's stdin (#3026): under Electron on Windows, process.stdin is a
 * stand-in that ends with no data, so the CLI reads fd 0 itself there.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { cliStdin } from '../../src/cli/stdin';

describe('cliStdin', () => {
  it('reads fd 0 directly under Electron on Windows', () => {
    const s = cliStdin({ platform: 'win32', electron: '45.1.0' });
    expect(s).toBeInstanceOf(fs.ReadStream);
    expect((s as fs.ReadStream & { fd: number }).fd).toBe(0);
    (s as fs.ReadStream).destroy();
  });

  it('is process.stdin everywhere else: plain Node on Windows, Electron elsewhere', () => {
    expect(cliStdin({ platform: 'win32', electron: undefined })).toBe(process.stdin);
    expect(cliStdin({ platform: 'darwin', electron: '45.1.0' })).toBe(process.stdin);
    expect(cliStdin({ platform: 'linux', electron: '45.1.0' })).toBe(process.stdin);
  });
});
