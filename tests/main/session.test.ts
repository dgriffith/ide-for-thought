/**
 * @vitest-environment node
 *
 * `session.ts` window-state persistence (#1913). Pins the config-loader
 * migration: a missing file reads as `[]`, a corrupt file is reported
 * (`reportConfigError`) rather than silently swallowed, and a malformed entry
 * in an otherwise-valid array is dropped rather than crashing the whole load.
 *
 * Also a regression test for the module-load-time `app.getPath` bug the
 * migration fixed as a byproduct: `filePath` used to be a module-level
 * constant, so merely importing this file called `app.getPath` — this test's
 * `electron` mock only answers *after* import, which would have thrown under
 * the old shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useTempDir } from '../helpers/temp-project';

const project = useTempDir('minerva-session-test-');

const h = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
}));

import { loadSession, saveSession, type WindowState } from '../../src/main/session';

beforeEach(() => {
  h.userData = project.root;
});

const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => consoleErrorSpy.mockClear());

const validWindow: WindowState = { x: 0, y: 0, width: 800, height: 600, rootPath: '/tb' };

describe('loadSession (#1913)', () => {
  it('returns [] when the file is missing, with no error reported', () => {
    expect(loadSession()).toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('round-trips a saved session', () => {
    saveSession([validWindow]);
    expect(loadSession()).toEqual([validWindow]);
  });

  it('reports and returns [] for a corrupt file instead of throwing', () => {
    fs.writeFileSync(path.join(project.root, 'session.json'), '{ not valid json', 'utf-8');
    expect(loadSession()).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('[config] failed to');
  });

  it('drops a malformed entry but keeps the valid ones alongside it', () => {
    const malformed = { x: 0, y: 0, width: 'wide', height: 600, rootPath: '/tb' };
    fs.writeFileSync(
      path.join(project.root, 'session.json'),
      JSON.stringify([validWindow, malformed]),
      'utf-8',
    );
    expect(loadSession()).toEqual([validWindow]);
  });
});
