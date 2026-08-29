/**
 * `logger(tag)` (#1918) — level control and per-tag silencing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, setLogLevel, setTagLevel, clearTagLevel } from '../../src/shared/logger';

const spies = {
  debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
  info: vi.spyOn(console, 'info').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
};

beforeEach(() => {
  setLogLevel('info');
  clearTagLevel('watcher');
  clearTagLevel('graph');
  Object.values(spies).forEach((s) => s.mockClear());
});

afterEach(() => {
  setLogLevel('info');
  clearTagLevel('watcher');
  clearTagLevel('graph');
});

describe('logger (#1918)', () => {
  it('folds [tag] into a leading string message, matching the pre-migration console output', () => {
    logger('watcher').warn('file changed', { path: 'a.md' });
    expect(spies.warn).toHaveBeenCalledWith('[watcher] file changed', { path: 'a.md' });
  });

  it('falls back to a separate leading argument when the first argument is not a string', () => {
    const payload = { path: 'a.md' };
    logger('watcher').warn(payload);
    expect(spies.warn).toHaveBeenCalledWith('[watcher]', payload);
  });

  it('routes each level to the matching console method', () => {
    setLogLevel('debug');
    const log = logger('graph');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(spies.debug).toHaveBeenCalledWith('[graph] d');
    expect(spies.info).toHaveBeenCalledWith('[graph] i');
    expect(spies.warn).toHaveBeenCalledWith('[graph] w');
    expect(spies.error).toHaveBeenCalledWith('[graph] e');
  });

  it('the default level (info) suppresses debug but not info/warn/error', () => {
    const log = logger('graph');
    log.debug('hidden');
    log.info('shown');
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalled();
  });

  it('setLogLevel raises the global floor for every tag without an override', () => {
    setLogLevel('warn');
    const log = logger('graph');
    log.info('hidden now');
    log.warn('still shown');
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalled();
  });

  it('setTagLevel overrides the global level for just that tag', () => {
    setLogLevel('warn');
    setTagLevel('watcher', 'debug');
    logger('watcher').debug('now visible');
    logger('graph').debug('still hidden — no override');
    expect(spies.debug).toHaveBeenCalledTimes(1);
    expect(spies.debug).toHaveBeenCalledWith('[watcher] now visible');
  });

  it('setTagLevel("silent") mutes a subsystem entirely, even at error level', () => {
    setTagLevel('watcher', 'silent');
    const log = logger('watcher');
    log.debug('x'); log.info('x'); log.warn('x'); log.error('x');
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });

  it('clearTagLevel restores the global level', () => {
    setTagLevel('watcher', 'silent');
    clearTagLevel('watcher');
    logger('watcher').error('back on');
    expect(spies.error).toHaveBeenCalledWith('[watcher] back on');
  });
});
