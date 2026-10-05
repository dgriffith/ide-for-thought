/**
 * "Renderer compromise ≠ code execution" is enforced, not hoped for (#2568).
 *
 * A compromised renderer can call any IPC channel and answer any dialog the
 * renderer draws. So every handler that can end in code running on the user's
 * machine must either:
 *  - be in PRIVILEGED_CHANNELS (src/main/ipc/privileged-channels.ts) and ask
 *    main's own native dialog (`confirmNative`, directly or through a helper
 *    that does) — checked here; or
 *  - be in EXEMPT below, with the reason it can't run anything new (e.g. it
 *    runs only code that already passed a privileged gate).
 *
 * The scan finds handlers by the sinks they reach (CODE_EXEC_SINKS). A new
 * handler that reaches one and is in neither list fails here, by name.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PRIVILEGED_CHANNELS } from '../../src/main/ipc/privileged-channels';
import { Channels } from '../../src/shared/channels';

const IPC_DIR = path.join(__dirname, '..', '..', 'src', 'main', 'ipc');

/** Calls that run, or set up running, code or a program. */
const CODE_EXEC_SINKS = /\b(grantConsent|setPythonSettings|probePythonInterpreter|addServer|updateServer|connectServer|setServerEnabled|runComputeCell|spawn|execFile|execFileSync|exec|openPath)\s*\(/;

/** What counts as "asked main's native dialog". */
const CONFIRMS = /\b(confirmNative|interpreterApproved|confirmStdioServer)\s*\(/;

const EXEMPT: Record<string, string> = {
  [Channels.COMPUTE_RUN_CELL]: 'runs only code with recorded consent (computeConsentGuard) — consent is granted only via COMPUTE_REQUEST_CONSENT',
  [Channels.CONVERSATION_RUN_COMPUTE_DRAFT]: 'same consent guard as COMPUTE_RUN_CELL',
  [Channels.MCP_SERVERS_CONNECT]: 'connects a stored server — every stdio command got into the store through a confirmed ADD/UPDATE (or the user\'s own ~/.minerva file)',
  [Channels.MCP_SERVERS_SET_ENABLED]: 'enabling connects a stored server — same as MCP_SERVERS_CONNECT',
  [Channels.SHELL_OPEN_IN_TERMINAL]: 'opens the user\'s terminal at a FOLDER (a file\'s containing folder) — never hands it a file, which Terminal would run',
};

const channelName = new Map(Object.entries(Channels).map(([k, v]) => [k, v as string]));

/** `handle(Channels.X, …)` blocks across the registrars, each up to the next handle(. */
function handlerBlocks(): Array<{ file: string; channel: string; body: string }> {
  const out: Array<{ file: string; channel: string; body: string }> = [];
  for (const f of fs.readdirSync(IPC_DIR).filter((n) => /^register-.*\.ts$/.test(n))) {
    const src = fs.readFileSync(path.join(IPC_DIR, f), 'utf-8');
    const re = /handle\(\s*Channels\.([A-Z0-9_]+)/g;
    const hits = [...src.matchAll(re)];
    hits.forEach((m, i) => {
      const body = src.slice(m.index, hits[i + 1]?.index ?? src.length);
      out.push({ file: f, channel: channelName.get(m[1]!) ?? m[1]!, body });
    });
  }
  return out;
}

/** Helper functions a registrar defines, which a handler body may call. */
function helperBodies(file: string): string {
  return fs.readFileSync(path.join(IPC_DIR, file), 'utf-8');
}

describe('privileged IPC needs main\'s native confirm (#2568)', () => {
  const blocks = handlerBlocks();

  it('every handler reaching a code-execution sink is privileged or exempt (with a reason)', () => {
    const unclassified = blocks
      .filter((b) => CODE_EXEC_SINKS.test(b.body) && !(b.channel in PRIVILEGED_CHANNELS) && !(b.channel in EXEMPT))
      .map((b) => `${b.file}: ${b.channel}`);
    expect(
      unclassified,
      'These handlers can end in code execution. Gate them with confirmNative and add them to PRIVILEGED_CHANNELS, ' +
        'or add them to EXEMPT with why they cannot run anything new. See docs/architecture-ratchets.md.',
    ).toEqual([]);
  });

  it('every privileged channel\'s handler asks main\'s native dialog', () => {
    for (const channel of Object.keys(PRIVILEGED_CHANNELS)) {
      const block = blocks.find((b) => b.channel === channel);
      expect(block, `${channel} is privileged but no registrar handles it`).toBeDefined();
      // The confirm may live in a helper the handler calls (interpreterApproved, confirmStdioServer).
      const calls = CONFIRMS.test(block!.body);
      expect(calls, `${channel}'s handler must call confirmNative (or a helper that does)`).toBe(true);
      if (!/\bconfirmNative\s*\(/.test(block!.body)) {
        expect(helperBodies(block!.file), `${block!.file}'s confirm helper must call confirmNative`).toMatch(/\bconfirmNative\s*\(/);
      }
    }
  });

  it('the exemptions still exist (shrink-only)', () => {
    for (const channel of Object.keys(EXEMPT)) {
      expect(blocks.some((b) => b.channel === channel), `${channel} is exempt but no longer handled — drop it`).toBe(true);
    }
  });

  it('the renderer can no longer grant compute consent itself', () => {
    expect(Object.values(Channels)).not.toContain('compute:grantConsent');
  });
});
