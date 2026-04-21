import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../src/shared/formatter/rules/yaml/yaml-timestamp';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(
  content: string,
  config: {
    updateModified?: boolean;
    insertCreated?: boolean;
    format?: 'iso-date' | 'iso';
  } = {},
) {
  return formatContent(content, {
    enabled: { 'yaml-timestamp': true },
    configs: { 'yaml-timestamp': { updateModified: true, insertCreated: true, format: 'iso-date', ...config } },
  });
}

describe('yaml-timestamp (#155)', () => {
  beforeEach(() => {
    // Pin "now" to a stable instant so tests are deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets `modified:` to today when updateModified is on', () => {
    const out = run('---\ntitle: foo\n---\n');
    expect(out).toContain('modified: 2026-04-21');
  });

  it('inserts `created:` when missing and insertCreated is on', () => {
    const out = run('---\ntitle: foo\n---\n');
    expect(out).toContain('created: 2026-04-21');
  });

  it('does not overwrite an existing `created:`', () => {
    const out = run('---\ncreated: 2020-01-01\ntitle: foo\n---\n');
    expect(out).toContain('created: 2020-01-01');
    expect(out).not.toContain('created: 2026-04-21');
  });

  it('is idempotent within the same day', () => {
    const once = run('---\ntitle: foo\n---\n');
    expect(run(once)).toBe(once);
  });

  it('emits full ISO timestamp when format is "iso"', () => {
    const out = run('---\ntitle: foo\n---\n', { format: 'iso' });
    expect(out).toContain('modified: 2026-04-21T12:00:00.000Z');
  });

  it('skips updateModified when the flag is off', () => {
    const out = run('---\ntitle: foo\n---\n', { updateModified: false });
    expect(out).not.toContain('modified:');
  });
});
