import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerExecutor,
  hasExecutor,
  registeredLanguages,
  runCell,
  _clearRegistry,
} from '../../../src/main/compute/registry';

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
