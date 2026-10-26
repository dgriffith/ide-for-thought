/**
 * Fleet-provenance attribution (#1151). Pins the mapping from a proposal's
 * `proposedBy` stamp to a legible, internal-vs-external label.
 */
import { describe, it, expect } from 'vitest';
import { describeProposer } from '../../src/shared/provenance';

describe('describeProposer', () => {
  it('names an external MCP client from its handshake name', () => {
    const info = describeProposer('mcp:claude-code');
    expect(info.kind).toBe('external');
    expect(info.agent).toBe('claude-code');
    expect(info.label).toBe('claude-code');
    expect(info.external).toBe(true);
  });

  it('falls back to "unknown" for an unnamed MCP client', () => {
    const info = describeProposer('mcp:');
    expect(info.kind).toBe('external');
    expect(info.agent).toBe('unknown');
    expect(info.external).toBe(true);
  });

  it('labels the headless CLI as external', () => {
    expect(describeProposer('cli')).toMatchObject({ kind: 'cli', label: 'CLI', external: true });
  });

  it('collapses every llm:* stamp to the internal Minerva AI', () => {
    for (const raw of ['llm:conversation:abc123', 'llm:auto-tag', 'llm:auto-link-inbound']) {
      const info = describeProposer(raw);
      expect(info.kind).toBe('internal');
      expect(info.label).toBe('Minerva AI');
      expect(info.external).toBe(false);
    }
  });

  it('names a plugin\'s model request by the plugin and the model, as from outside Minerva\'s own AI (#2858)', () => {
    expect(describeProposer('plugin:tidy@1.2.0+llm:claude-opus-5')).toMatchObject({ kind: 'plugin', agent: 'tidy', label: 'tidy (plugin, claude-opus-5)', external: true });
    expect(describeProposer('plugin:tidy')).toMatchObject({ kind: 'plugin', label: 'tidy (plugin)' });
  });

  it('shows an unrecognised stamp as-is, not flagged external', () => {
    expect(describeProposer('e2e')).toMatchObject({ kind: 'unknown', label: 'e2e', external: false });
  });

  it('handles an empty / missing stamp without throwing', () => {
    expect(describeProposer('')).toMatchObject({ label: 'unknown', external: false });
    expect(describeProposer(null)).toMatchObject({ label: 'unknown', external: false });
    expect(describeProposer(undefined)).toMatchObject({ label: 'unknown', external: false });
  });

  it('preserves the raw stamp for search / tooltips', () => {
    expect(describeProposer('mcp:browser-agent').raw).toBe('mcp:browser-agent');
  });
});
