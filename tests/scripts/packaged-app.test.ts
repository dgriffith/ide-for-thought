/**
 * @vitest-environment node
 *
 * Where the packaged app is on each platform (#2981, #2179): the fuse
 * read-back and the packaged e2e specs both find it through this one table.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { LINUX_EXECUTABLE_NAME, packagedAppPaths } from '../../scripts/lib/packaged-app.mjs';

const ROOT = path.join(path.sep, 'repo');
const out = (...p: string[]) => path.join(ROOT, 'out', ...p);

describe('packagedAppPaths', () => {
  it('macOS: the .app bundle, its binary and Resources inside it', () => {
    expect(packagedAppPaths(ROOT, 'darwin', 'arm64')).toEqual({
      dir: out('Minerva-darwin-arm64'),
      app: out('Minerva-darwin-arm64', 'Minerva.app'),
      binary: out('Minerva-darwin-arm64', 'Minerva.app', 'Contents', 'MacOS', 'Minerva'),
      resources: out('Minerva-darwin-arm64', 'Minerva.app', 'Contents', 'Resources'),
    });
  });

  it('Linux: a lower-case `minerva` beside resources/, the name forge.config.ts sets', () => {
    expect(LINUX_EXECUTABLE_NAME).toBe('minerva');
    const p = packagedAppPaths(ROOT, 'linux', 'x64');
    expect(p).toEqual({
      dir: out('Minerva-linux-x64'),
      app: out('Minerva-linux-x64', 'minerva'),
      binary: out('Minerva-linux-x64', 'minerva'),
      resources: out('Minerva-linux-x64', 'resources'),
    });
  });

  it('Windows: Minerva.exe beside resources/', () => {
    const p = packagedAppPaths(ROOT, 'win32', 'x64');
    expect(p.binary).toBe(out('Minerva-win32-x64', 'Minerva.exe'));
    expect(p.app).toBe(p.binary);
    expect(p.resources).toBe(out('Minerva-win32-x64', 'resources'));
  });
});
