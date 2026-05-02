/**
 * Per-project config (`.minerva/config.json`) — round-trip behaviour
 * including the new Python trust slice (#373).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  readProjectConfig,
  patchProjectConfig,
  getBibliographyStyleId,
  setBibliographyStyleId,
  getPythonTrust,
  setPythonTrust,
} from '../../src/main/project-config';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-config-test-'));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('readProjectConfig (#373)', () => {
  it('returns {} when the file is missing', () => {
    expect(readProjectConfig(root)).toEqual({});
  });

  it('returns {} on JSON parse error', () => {
    fs.mkdirSync(path.join(root, '.minerva'), { recursive: true });
    fs.writeFileSync(path.join(root, '.minerva/config.json'), '{ invalid json', 'utf-8');
    expect(readProjectConfig(root)).toEqual({});
  });
});

describe('patchProjectConfig (#373)', () => {
  it('writes a new file when none exists', () => {
    patchProjectConfig(root, { baseUri: 'https://example.com/' });
    expect(readProjectConfig(root).baseUri).toBe('https://example.com/');
  });

  it('preserves unrelated keys', () => {
    patchProjectConfig(root, { baseUri: 'https://example.com/' });
    patchProjectConfig(root, { bibliography: { styleId: 'mla' } });
    const cfg = readProjectConfig(root);
    expect(cfg.baseUri).toBe('https://example.com/');
    expect(cfg.bibliography?.styleId).toBe('mla');
  });
});

describe('getPythonTrust / setPythonTrust (#373)', () => {
  it('default is false', () => {
    expect(getPythonTrust(root)).toBe(false);
  });

  it('set true round-trips', () => {
    setPythonTrust(root, true);
    expect(getPythonTrust(root)).toBe(true);
  });

  it('set false round-trips', () => {
    setPythonTrust(root, true);
    setPythonTrust(root, false);
    expect(getPythonTrust(root)).toBe(false);
  });

  it('does not clobber baseUri or bibliography slices', () => {
    patchProjectConfig(root, { baseUri: 'https://example.com/' });
    setBibliographyStyleId(root, 'mla');
    setPythonTrust(root, true);
    const cfg = readProjectConfig(root);
    expect(cfg.baseUri).toBe('https://example.com/');
    expect(cfg.bibliography?.styleId).toBe('mla');
    expect(cfg.compute?.pythonTrusted).toBe(true);
  });

  it('only counts a literal `true` value as trust (defensive against truthy non-bools)', () => {
    fs.mkdirSync(path.join(root, '.minerva'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.minerva/config.json'),
      JSON.stringify({ compute: { pythonTrusted: 'yes' } }),
      'utf-8',
    );
    expect(getPythonTrust(root)).toBe(false);
  });

  it('preserves existing compute.<other> fields when toggling trust', () => {
    // Hand-write a future field the type doesn't yet model.
    fs.mkdirSync(path.join(root, '.minerva'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.minerva/config.json'),
      JSON.stringify({ compute: { pythonTrusted: false, futureField: 'preserved' } }),
      'utf-8',
    );
    setPythonTrust(root, true);
    const raw = JSON.parse(fs.readFileSync(path.join(root, '.minerva/config.json'), 'utf-8'));
    expect(raw.compute.pythonTrusted).toBe(true);
    expect(raw.compute.futureField).toBe('preserved');
  });

  it('getBibliographyStyleId still works alongside the new compute slice', () => {
    setBibliographyStyleId(root, 'mla');
    setPythonTrust(root, true);
    expect(getBibliographyStyleId(root)).toBe('mla');
  });
});
