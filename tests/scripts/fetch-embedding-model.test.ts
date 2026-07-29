/**
 * Integrity-pin tests for the embedding-model fetch script (#1489 / A08).
 *
 * The script's real enforcement is at build time — a fetched file whose bytes
 * don't match the pinned SHA-256 throws, failing CI rather than shipping
 * tampered weights. These tests lock the pieces that make that enforcement
 * sound: the hash helper is correct, `fileHasSha` accepts only exact-byte
 * matches, and the pins themselves are well-formed and immutable (an actual
 * commit SHA, never the moving `main` branch — a regression that reverts the
 * pin to `main` would silently reopen the integrity hole).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error -- plain JS build-time module, no .d.ts
import { sha256, fileHasSha, FILES, REVISION } from '../../scripts/fetch-embedding-model.mjs';

const hash = sha256 as (buf: Buffer) => string;
const hasSha = fileHasSha as (p: string, expected: string) => boolean;
const files = FILES as { rel: string; sha256: string }[];
const revision = REVISION as string;

describe('sha256', () => {
  it('computes the standard SHA-256 of the input bytes', () => {
    // Known vector: sha256("abc").
    expect(hash(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('fileHasSha', () => {
  it('accepts a file whose bytes match, rejects a mismatch or a missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-hashpin-'));
    try {
      const p = path.join(dir, 'f.bin');
      fs.writeFileSync(p, Buffer.from('abc'));
      const good = hash(Buffer.from('abc'));
      expect(hasSha(p, good)).toBe(true);
      expect(hasSha(p, 'deadbeef'.repeat(8))).toBe(false); // wrong (tampered) bytes
      expect(hasSha(path.join(dir, 'missing.bin'), good)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pinned integrity metadata', () => {
  it('pins an immutable 40-hex commit SHA, not a moving ref', () => {
    expect(revision).toMatch(/^[0-9a-f]{40}$/);
    expect(revision).not.toBe('main');
  });

  it('pins a well-formed SHA-256 for each of the four required files', () => {
    const rels = files.map((f) => f.rel).sort();
    expect(rels).toEqual([
      'config.json',
      'onnx/model_quantized.onnx',
      'tokenizer.json',
      'tokenizer_config.json',
    ]);
    for (const f of files) {
      expect(f.sha256, `${f.rel} sha256`).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
