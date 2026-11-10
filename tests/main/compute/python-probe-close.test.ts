/**
 * @vitest-environment node
 *
 * The interpreter probe reads the version once the child's output has ended
 * (`close`), not when the process exits (`exit`), which can come first. A
 * real `python3 --version` that exited 0 before its stdout was read came back
 * as "no version" under load (a CI coverage run).
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/minerva-probe-close-test' } }));

import { probePythonInterpreter } from '../../../src/main/compute/python-settings';

/** A child that exits first, and only then has its output read. */
function exitsBeforeItsOutput(output: string): EventEmitter {
  const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
  setTimeout(() => {
    proc.emit('exit', 0, null);
    proc.stdout.emit('data', Buffer.from(output));
    proc.emit('close', 0, null);
  }, 0);
  return proc;
}

describe('probePythonInterpreter reads the version once the output has ended', () => {
  it('a child that exits before its output is read still reports its version', async () => {
    spawnMock.mockReturnValueOnce(exitsBeforeItsOutput('Python 3.12.4\n'));
    const r = await probePythonInterpreter('python3');
    if (!r.ok) throw new Error(`expected a successful probe, got: ${r.error}`);
    expect(r.version).toBe('Python 3.12.4');
  });

  it('a child that prints no version still fails, with its exit code', async () => {
    spawnMock.mockReturnValueOnce(exitsBeforeItsOutput(''));
    const r = await probePythonInterpreter('python3');
    expect(r).toMatchObject({ ok: false, path: 'python3', error: 'Process exited with code 0' });
  });
});
