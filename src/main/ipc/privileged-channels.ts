/**
 * IPC channels that can end in code execution on the user's machine (#2568).
 *
 * Each handler asks `confirmNative` (main's own dialog, which the renderer
 * cannot draw or answer) before doing the dangerous part.
 * `tests/architecture/privileged-ipc-confirm.test.ts` holds that: every
 * channel here has a registrar that calls `confirmNative`, and every channel
 * the CODE_EXEC_SINKS scan finds reaching a code-execution sink is listed here.
 */
import { Channels } from '../../shared/channels';

export const PRIVILEGED_CHANNELS: Readonly<Record<string, string>> = {
  [Channels.COMPUTE_REQUEST_CONSENT]: 'records consent to run a cell (and optionally all compute in a thoughtbase)',
  [Channels.MCP_SERVERS_ADD]: 'a stdio server is a program Minerva will run',
  [Channels.MCP_SERVERS_UPDATE]: 'changing a stdio server\'s command/args/env/cwd changes the program Minerva runs',
  [Channels.COMPUTE_SET_PYTHON_SETTINGS]: 'the interpreter path is the program every Python cell runs',
  [Channels.COMPUTE_PROBE_PYTHON]: 'probing runs `<path> --version`',
  [Channels.SHELL_OPEN_IN_DEFAULT]: 'opening an app, script or installer runs it (documents open unprompted)',
};
