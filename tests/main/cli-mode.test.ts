/**
 * When the app binary is the `minerva` CLI (#2565).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { dock: { hide: vi.fn() } } }));

import fs from 'node:fs';
import path from 'node:path';
import { cliModeArgs, CLI_MODE_FLAG } from '../../src/main/cli-mode';
import { CLI_COMMANDS } from '../../src/shared/cli-commands';

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
    // The flag only counts before any argument that isn't a switch.
    expect(cliModeArgs([EXE, '/x', CLI_MODE_FLAG], {})).toBeNull();
    // A command word anywhere but first is a file argument (`minerva notes sql`).
    expect(cliModeArgs([EXE, '/Users/me/notes', 'sql'], {})).toBeNull();
    expect(cliModeArgs([EXE, '--no-sandbox', 'sql'], {})).toBeNull();
  });
});

describe('the binary on PATH (#1440)', () => {
  const BIN = '/usr/lib/minerva/minerva';

  it('`minerva <command> …` is the CLI, with no flag — how Linux packages install it', () => {
    expect(cliModeArgs([BIN, 'sql', 'SELECT 1', '--project', '/tb'], {})).toEqual(['sql', 'SELECT 1', '--project', '/tb']);
    expect(cliModeArgs([BIN, 'mcp'], {})).toEqual(['mcp']);
    expect(cliModeArgs([BIN, 'propose-note', 'n.md'], {})).toEqual(['propose-note', 'n.md']);
    for (const c of CLI_COMMANDS) expect(cliModeArgs([BIN, c], {}), c).toEqual([c]);
  });

  it('the flag still works after leading switches a launcher prepends', () => {
    expect(cliModeArgs([BIN, '--no-sandbox', CLI_MODE_FLAG, '--', 'sql', 'x'], {})).toEqual(['sql', 'x']);
  });

  it('a bare `minerva`, a file, or a desktop launch with %U is the app', () => {
    expect(cliModeArgs([BIN], {})).toBeNull();
    expect(cliModeArgs([BIN, '/home/me/notes/Plan.md'], {})).toBeNull();
    expect(cliModeArgs([BIN, 'Plan.md'], {})).toBeNull();
    expect(cliModeArgs([BIN, '--no-sandbox'], {})).toBeNull();
  });

  it('CLI_COMMANDS is exactly what src/cli/run.ts dispatches', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'cli', 'run.ts'), 'utf-8');
    const dispatched = new Set([
      ...[...src.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]!),
      ...[...src.matchAll(/args\.command === '([a-z-]+)'/g)].map((m) => m[1]!),
    ]);
    expect([...dispatched].sort()).toEqual([...CLI_COMMANDS].sort());
  });
});
