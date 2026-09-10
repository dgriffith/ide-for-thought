/**
 * Scope-union logic + step-up retry ceiling (#2030).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetStepUpAttemptsForTests,
  clearStepUpAttempts,
  recordStepUpAttempt,
  unionScopes,
} from '../../../../src/main/mcp-client/oauth/step-up';
import { McpStepUpRetryLimitExceededError } from '../../../../src/main/mcp-client/errors';

beforeEach(() => _resetStepUpAttemptsForTests());

describe('unionScopes', () => {
  it('unions overlapping scope sets, sorted, space-separated', () => {
    expect(unionScopes('files:read tools:call', 'files:read files:write')).toBe('files:read files:write tools:call');
  });

  it('unions disjoint scope sets', () => {
    expect(unionScopes('a', 'b')).toBe('a b');
  });

  it('handles an empty previous grant', () => {
    expect(unionScopes('', 'a b')).toBe('a b');
  });

  it('handles an empty challenge', () => {
    expect(unionScopes('a b', '')).toBe('a b');
  });

  it('handles both empty', () => {
    expect(unionScopes('', '')).toBe('');
  });

  it('collapses duplicate/extra whitespace', () => {
    expect(unionScopes('a  a', 'a   b')).toBe('a b');
  });
});

describe('recordStepUpAttempt / clearStepUpAttempts', () => {
  it('allows up to the retry ceiling, then throws', () => {
    expect(() => recordStepUpAttempt('https://mcp.example.com', 'a b')).not.toThrow();
    expect(() => recordStepUpAttempt('https://mcp.example.com', 'a b')).not.toThrow();
    expect(() => recordStepUpAttempt('https://mcp.example.com', 'a b')).toThrow(McpStepUpRetryLimitExceededError);
  });

  it('tracks attempts independently per (server, scope) pair', () => {
    recordStepUpAttempt('https://a.example.com', 'x');
    recordStepUpAttempt('https://a.example.com', 'x');
    // A different server, or a different scope union, is a separate counter.
    expect(() => recordStepUpAttempt('https://b.example.com', 'x')).not.toThrow();
    expect(() => recordStepUpAttempt('https://a.example.com', 'y')).not.toThrow();
  });

  it('clearStepUpAttempts resets the counter for that pair', () => {
    recordStepUpAttempt('https://mcp.example.com', 'a b');
    recordStepUpAttempt('https://mcp.example.com', 'a b');
    clearStepUpAttempts('https://mcp.example.com', 'a b');
    expect(() => recordStepUpAttempt('https://mcp.example.com', 'a b')).not.toThrow();
  });
});
