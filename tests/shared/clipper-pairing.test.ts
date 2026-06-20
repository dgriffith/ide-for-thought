/**
 * Clipper pairing-code codec (#791) — the app encodes, the extension (#792)
 * decodes, so the round-trip and malformed-input handling must be exact.
 */

import { describe, it, expect } from 'vitest';
import { encodePairingCode, decodePairingCode } from '../../src/shared/clipper-pairing';

describe('clipper pairing code', () => {
  it('round-trips port + secret', () => {
    const code = encodePairingCode(41599, 'deadbeef'.repeat(8));
    expect(decodePairingCode(code)).toEqual({ v: 1, port: 41599, secret: 'deadbeef'.repeat(8) });
  });

  it('is URL-safe (no +, /, or = padding)', () => {
    const code = encodePairingCode(65535, 'a'.repeat(64));
    expect(code).not.toMatch(/[+/=]/);
  });

  it('tolerates surrounding whitespace on decode', () => {
    const code = encodePairingCode(8080, 'secret');
    expect(decodePairingCode(`  ${code}\n`)?.port).toBe(8080);
  });

  it('returns null for malformed input', () => {
    expect(decodePairingCode('not-base64!!')).toBeNull();
    expect(decodePairingCode('')).toBeNull();
  });

  it('rejects a wrong version or missing fields', () => {
    const wrongVersion = Buffer.from(JSON.stringify({ v: 2, port: 1, secret: 'x' })).toString('base64url');
    expect(decodePairingCode(wrongVersion)).toBeNull();
    const noSecret = Buffer.from(JSON.stringify({ v: 1, port: 1, secret: '' })).toString('base64url');
    expect(decodePairingCode(noSecret)).toBeNull();
    const noPort = Buffer.from(JSON.stringify({ v: 1, secret: 'x' })).toString('base64url');
    expect(decodePairingCode(noPort)).toBeNull();
  });
});
