/**
 * RFC 9207 issuer validation (#2030) — the four-row truth table, plus a
 * strict-string-comparison check (not URL-normalized equivalence).
 */
import { describe, it, expect } from 'vitest';
import { validateIssuer } from '../../../../src/main/mcp-client/oauth/issuer-validation';

const EXPECTED = 'https://as.example.com';

describe('validateIssuer (RFC 9207)', () => {
  it('iss present and matching → valid', () => {
    expect(validateIssuer(EXPECTED, EXPECTED, true)).toEqual({ valid: true });
  });

  it('iss present and matching, even when the AS does not advertise support → valid', () => {
    expect(validateIssuer(EXPECTED, EXPECTED, false)).toEqual({ valid: true });
  });

  it('iss present but mismatched → invalid, regardless of AS support', () => {
    const result = validateIssuer('https://attacker.example', EXPECTED, true);
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/does not match/);
  });

  it('iss present but mismatched, AS does not advertise support → still invalid (always checked when present)', () => {
    const result = validateIssuer('https://attacker.example', EXPECTED, false);
    expect(result.valid).toBe(false);
  });

  it('iss absent, AS advertises support → invalid (suspicious omission)', () => {
    const result = validateIssuer(undefined, EXPECTED, true);
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/omitted/);
  });

  it('iss absent, AS does not advertise support → valid (pre-RFC-9207 behavior)', () => {
    expect(validateIssuer(undefined, EXPECTED, false)).toEqual({ valid: true });
  });

  it('rejects a URL-equivalent-but-differently-spelled issuer (strict string compare)', () => {
    // A trailing slash makes this a DIFFERENT string, even though URL
    // normalization might treat it as "the same" origin.
    const result = validateIssuer(`${EXPECTED}/`, EXPECTED, true);
    expect(result.valid).toBe(false);
  });
});
