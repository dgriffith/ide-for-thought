import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerExecutor,
  hasExecutor,
  registeredLanguages,
  runCell,
  _clearRegistry,
} from '../../../src/main/compute/registry';
import { registerBuiltinExecutors, registerPythonExecutor } from '../../../src/main/compute/executors';
import { RUNNABLE_LANGUAGES, TRUST_GATED_LANGUAGES } from '../../../src/shared/compute/fences';

describe('compute registry (#238)', () => {
  beforeEach(() => {
    _clearRegistry();
  });

  it('returns ok:false with a clear message when no executor is registered', async () => {
    const result = await runCell('sparql', 'SELECT 1', { rootPath: '/tmp' });
    expect(result).toEqual({
      ok: false,
      error: 'No executor registered for language "sparql"',
    });
  });

  it('dispatches to the registered executor and returns its result', async () => {
    registerExecutor('sparql', async (code) => ({
      ok: true,
      output: { type: 'text', value: `ran: ${code}` },
    }));
    const result = await runCell('sparql', 'SELECT 1', { rootPath: '/tmp' });
    expect(result).toEqual({
      ok: true,
      output: { type: 'text', value: 'ran: SELECT 1' },
    });
  });

  it('catches executor throws into ok:false', async () => {
    registerExecutor('bad', async () => { throw new Error('boom'); });
    const result = await runCell('bad', 'x', { rootPath: '/tmp' });
    expect(result).toEqual({ ok: false, error: 'boom' });
  });

  it('is case-insensitive on the language key', async () => {
    registerExecutor('sql', async () => ({ ok: true, output: { type: 'text', value: 'ok' } }));
    expect(hasExecutor('SQL')).toBe(true);
    const result = await runCell('SQL', 'SELECT 1', { rootPath: '/tmp' });
    expect(result.ok).toBe(true);
  });

  it('registeredLanguages lists every registered key, sorted', () => {
    registerExecutor('python', async () => ({ ok: true, output: { type: 'text', value: '' } }));
    registerExecutor('sparql', async () => ({ ok: true, output: { type: 'text', value: '' } }));
    registerExecutor('sql', async () => ({ ok: true, output: { type: 'text', value: '' } }));
    expect(registeredLanguages()).toEqual(['python', 'sparql', 'sql']);
  });

  it('re-registering replaces the prior executor', async () => {
    registerExecutor('sql', async () => ({ ok: true, output: { type: 'text', value: 'v1' } }));
    registerExecutor('sql', async () => ({ ok: true, output: { type: 'text', value: 'v2' } }));
    const result = await runCell('sql', 'x', { rootPath: '/tmp' });
    expect(result.ok && result.output.type === 'text' && result.output.value).toBe('v2');
  });

  it('builtin registrations plus the Python plugin\'s match the shared RUNNABLE_LANGUAGES list, aliases included', () => {
    // The renderer decides which fences show a run affordance from
    // RUNNABLE_LANGUAGES; both now derive from COMPUTE_LANGUAGES (#2630), and
    // the executor table is keyed by it — this pins that every alias
    // registers too, so a fence never shows a ▶ the backend can't run.
    // Python is a built-in plugin (#2822): app-ready registers the rest, and
    // turning the plugin on registers Python and its aliases.
    registerBuiltinExecutors();
    expect(registeredLanguages()).toEqual(['sparql', 'sql']);
    const off = registerPythonExecutor();
    expect(registeredLanguages()).toEqual([...RUNNABLE_LANGUAGES].sort());
    off();
    expect(registeredLanguages()).toEqual(['sparql', 'sql']);
  });

  it('a Python cell with the plugin off says it\'s turned off, not that something is broken (#2822)', async () => {
    _clearRegistry();
    for (const lang of ['python', 'py', 'python3']) {
      expect(await runCell(lang, 'print(1)', { rootPath: '/tmp' })).toEqual({
        ok: false, error: 'Python cells are turned off on this machine. Turn on Python in Settings → Plugins to run them.',
      });
    }
  });

  it('every runnable language and alias is trust-gated — `py` can\'t slip past a gate on `python`', () => {
    for (const lang of RUNNABLE_LANGUAGES) expect(TRUST_GATED_LANGUAGES.has(lang), lang).toBe(true);
    expect(TRUST_GATED_LANGUAGES.has('py')).toBe(true);
    expect(TRUST_GATED_LANGUAGES.has('python3')).toBe(true);
  });

  it('passes the ExecutorContext through to the executor', async () => {
    let seen: { rootPath: string; notePath?: string } | null = null;
    registerExecutor('sql', async (_code, ctx) => {
      seen = { rootPath: ctx.rootPath, notePath: ctx.notePath };
      return { ok: true, output: { type: 'text', value: 'ok' } };
    });
    await runCell('sql', 'x', { rootPath: '/tmp/proj', notePath: 'notes/x.md' });
    expect(seen).toEqual({ rootPath: '/tmp/proj', notePath: 'notes/x.md' });
  });
});
