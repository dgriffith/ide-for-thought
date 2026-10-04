/**
 * When the app binary is the `minerva` CLI (#2565).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { dock: { hide: vi.fn() } } }));

import { cliModeArgs, CLI_MODE_FLAG } from '../../src/main/cli-mode';

const EXE = '/Applications/Minerva.app/Contents/MacOS/Minerva';
const CLI = '/Applications/Minerva.app/Contents/Resources/app.asar/.vite/build/cli.js';

describe('cliModeArgs (#2565)', () => {
  it('the current shim: everything after `--minerva-cli --`, verbatim', () => {
    expect(cliModeArgs([EXE, CLI_MODE_FLAG, '--', 'query', 'SELECT 1', '--project', '/tb'], {}))
      .toEqual(['query', 'SELECT 1', '--project', '/tb']);
    // Arguments that look like switches stay arguments.
    expect(cliModeArgs([EXE, CLI_MODE_FLAG, '--', '--help'], {})).toEqual(['--help']);
    expect(cliModeArgs([EXE, CLI_MODE_FLAG, 'mcp'], {})).toEqual(['mcp']);
  });

  it('an old shim (RunAsNode-era) is still recognised', () => {
    expect(cliModeArgs([EXE, CLI, 'sql', 'SELECT 1'], { ELECTRON_RUN_AS_NODE: '1' })).toEqual(['sql', 'SELECT 1']);
  });

  it('is not CLI mode otherwise', () => {
    expect(cliModeArgs([EXE], {})).toBeNull();
    expect(cliModeArgs([EXE, '/Users/me/notes'], {})).toBeNull(); // open a folder
    // The old shape WITHOUT the variable is just a file argument to the app.
    expect(cliModeArgs([EXE, CLI, 'sql'], {})).toBeNull();
    // ELECTRON_RUN_AS_NODE=1 with arbitrary code is NOT routed anywhere.
    expect(cliModeArgs([EXE, '-e', 'require("child_process")'], { ELECTRON_RUN_AS_NODE: '1' })).toBeNull();
    // The flag only counts as the first argument.
    expect(cliModeArgs([EXE, '/x', CLI_MODE_FLAG], {})).toBeNull();
  });
});
