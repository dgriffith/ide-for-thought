/**
 * Which plugin code is running (#2825): an active built-in plugin or an
 * enabled installed one, with a `code` section — asked again per call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginScan } from '../../../src/shared/plugins/format';

const h = vi.hoisted((): { active: Set<string>; scan: PluginScan } => ({
  active: new Set<string>(),
  scan: { plugins: [], errors: [] },
}));
vi.mock('../../../src/main/core-plugins-active', () => ({ isCorePluginActive: (id: string) => h.active.has(id) }));
vi.mock('../../../src/main/plugins/registry', () => ({ loadedPluginScan: () => h.scan }));
vi.mock('../../../src/main/plugins/core', () => ({
  corePlugin: (id: string) => (id === 'python'
    ? { manifest: { id: 'python', name: 'Python', version: '1.0.0', code: { capabilities: ['process'] } } }
    : id === 'plain-core' ? { manifest: { id: 'plain-core', name: 'Plain', version: '1.0.0' } } : undefined),
}));

import { codePluginIdentity, _registerCodePluginForE2E } from '../../../src/main/plugins/code-plugins';

beforeEach(() => {
  h.active.clear();
  h.scan = { plugins: [], errors: [] };
});

describe('codePluginIdentity (#2825)', () => {
  it('is a built-in plugin with code only while it is active', () => {
    expect(codePluginIdentity('python')).toBeNull();
    h.active.add('python');
    expect(codePluginIdentity('python')).toEqual({ id: 'python', name: 'Python', version: '1.0.0', capabilities: ['process'] });
  });

  it('is nothing for a built-in plugin without code, even active', () => {
    h.active.add('plain-core');
    expect(codePluginIdentity('plain-core')).toBeNull();
  });

  it('is an enabled installed plugin with code, and nothing for one without', () => {
    h.scan = { plugins: [
      { manifest: { id: 'board', name: 'Board', version: '2.0.0', code: { capabilities: ['ui', 'notes:read'] } } },
      { manifest: { id: 'words', name: 'Words', version: '1.0.0' } },
    ], errors: [] } as unknown as PluginScan;
    expect(codePluginIdentity('board')).toEqual({ id: 'board', name: 'Board', version: '2.0.0', capabilities: ['ui', 'notes:read'] });
    expect(codePluginIdentity('words')).toBeNull();
    expect(codePluginIdentity('absent')).toBeNull();
  });

  it('answers the e2e fixture it was told to', () => {
    _registerCodePluginForE2E({ id: 'hostile', name: 'Hostile', version: '0.0.1', capabilities: ['notes:read'] });
    expect(codePluginIdentity('hostile')?.capabilities).toEqual(['notes:read']);
  });
});
