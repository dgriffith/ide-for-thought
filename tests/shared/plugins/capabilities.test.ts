/**
 * The capability list (#2823): closed, each with a tier and a description
 * that reads as part of "It can …".
 */
import { describe, it, expect } from 'vitest';
import { describeCapabilities, isPluginCapability, PLUGIN_CAPABILITIES } from '../../../src/shared/plugins/capabilities';

describe('PLUGIN_CAPABILITIES (#2823)', () => {
  it('only running a program is tier C, and nothing reaches the network, secrets or files', () => {
    const byTier = (t: string) => Object.entries(PLUGIN_CAPABILITIES).filter(([, v]) => v.tier === t).map(([k]) => k);
    expect(byTier('C')).toEqual(['process']);
    expect(Object.keys(PLUGIN_CAPABILITIES).some((k) => /net|fetch|secret|file|fs/.test(k))).toBe(false);
  });

  it('is closed: an unknown name, or an inherited one, isn\'t a capability', () => {
    expect(isPluginCapability('ui')).toBe(true);
    expect(isPluginCapability('network')).toBe(false);
    expect(isPluginCapability('toString')).toBe(false);
  });

  it('describes a plugin\'s capabilities as one sentence', () => {
    expect(describeCapabilities([])).toBe('');
    expect(describeCapabilities(['process'])).toBe('It can run a program on this machine.');
    expect(describeCapabilities(['notes:read', 'process'])).toBe(
      'It can read the notes Minerva hands its views and commands; and run a program on this machine.',
    );
    expect(describeCapabilities(['notes:read', 'ui', 'notes:write-properties'])).toBe(
      'It can read the notes Minerva hands its views and commands; open notes, show menus and make announcements; and change the properties of notes it was given.',
    );
  });
});
