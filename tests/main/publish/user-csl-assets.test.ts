/**
 * User-imported CSL styles + locales (#302).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadUserStyles,
  loadUserLocales,
  getMergedStyles,
  getMergedLocales,
  isValidCslStyle,
  isValidCslLocale,
  extractStyleTitle,
  deriveStyleId,
  deriveLocaleId,
} from '../../../src/main/publish/csl/user-assets';
import { loadCitationAssets } from '../../../src/main/publish/csl';
import { BUNDLED_STYLES } from '../../../src/main/publish/csl/assets';

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-user-csl-'));
}

const MIN_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text">
  <info>
    <title>My Custom Style</title>
    <id>http://example.com/styles/custom</id>
    <updated>2026-05-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text variable="title"/></layout></citation>
</style>`;

const MIN_LOCALE = `<?xml version="1.0" encoding="utf-8"?>
<locale xmlns="http://purl.org/net/xbiblio/csl" version="1.0" xml:lang="en-GB">
  <terms><term name="and">and</term></terms>
</locale>`;

describe('CSL validation helpers (#302)', () => {
  it('isValidCslStyle accepts a real CSL <style> root', () => {
    expect(isValidCslStyle(MIN_CSL)).toBe(true);
  });

  it('isValidCslStyle rejects garbage', () => {
    expect(isValidCslStyle('<html><body>nope</body></html>')).toBe(false);
    expect(isValidCslStyle('not even xml')).toBe(false);
    expect(isValidCslStyle('')).toBe(false);
  });

  it('isValidCslStyle rejects a locale file', () => {
    expect(isValidCslStyle(MIN_LOCALE)).toBe(false);
  });

  it('isValidCslLocale accepts a real <locale> root', () => {
    expect(isValidCslLocale(MIN_LOCALE)).toBe(true);
  });

  it('isValidCslLocale rejects a style file', () => {
    expect(isValidCslLocale(MIN_CSL)).toBe(false);
  });

  it('extractStyleTitle pulls <info><title>…</title> out of the XML', () => {
    expect(extractStyleTitle(MIN_CSL)).toBe('My Custom Style');
  });

  it('extractStyleTitle decodes XML entities and ignores body titles', () => {
    const xml = `<style xmlns="http://purl.org/net/xbiblio/csl">
      <info><title>Acme &amp; Co. Style</title></info>
      <citation><layout><title>not this one</title></layout></citation>
    </style>`;
    expect(extractStyleTitle(xml)).toBe('Acme & Co. Style');
  });

  it('extractStyleTitle returns null when the title is absent', () => {
    expect(extractStyleTitle('<style><info></info></style>')).toBeNull();
  });
});

describe('id derivation (#302)', () => {
  it('deriveStyleId lowercases, drops .csl, and slugifies', () => {
    expect(deriveStyleId('Chicago Manual of Style.csl')).toBe('chicago-manual-of-style');
    expect(deriveStyleId('apa.csl')).toBe('apa');
    // Strip the Zotero "locales-" filename prefix that styles never wear.
    expect(deriveStyleId('weird (variant).csl')).toBe('weird-variant');
  });

  it('deriveStyleId returns empty when input is junk', () => {
    expect(deriveStyleId('---')).toBe('');
    expect(deriveStyleId('.csl')).toBe('');
  });

  it('deriveLocaleId preserves case (locale ids like en-GB are case-significant)', () => {
    expect(deriveLocaleId('locales-en-GB.xml')).toBe('en-GB');
    expect(deriveLocaleId('de-DE.xml')).toBe('de-DE');
  });
});

describe('loadUserStyles + loadUserLocales (#302)', () => {
  let root: string;

  beforeEach(() => { root = mkProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('returns [] when the .minerva directories don\'t exist', async () => {
    expect(await loadUserStyles(root)).toEqual([]);
    expect(await loadUserLocales(root)).toEqual([]);
  });

  it('loads valid .csl files from .minerva/csl-styles/', async () => {
    await fsp.mkdir(path.join(root, '.minerva/csl-styles'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/csl-styles/custom.csl'), MIN_CSL, 'utf-8');
    const styles = await loadUserStyles(root);
    expect(styles).toHaveLength(1);
    expect(styles[0].id).toBe('custom');
    expect(styles[0].label).toBe('My Custom Style');
  });

  it('skips files that don\'t parse as CSL styles', async () => {
    const dir = path.join(root, '.minerva/csl-styles');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'good.csl'), MIN_CSL, 'utf-8');
    await fsp.writeFile(path.join(dir, 'bad.csl'), '<not-a-style/>', 'utf-8');
    const styles = await loadUserStyles(root);
    expect(styles.map((s) => s.id)).toEqual(['good']);
  });

  it('strips the "locales-" prefix when deriving a locale id', async () => {
    const dir = path.join(root, '.minerva/csl-locales');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'locales-en-GB.xml'), MIN_LOCALE, 'utf-8');
    const locales = await loadUserLocales(root);
    expect(locales[0].id).toBe('en-GB');
  });
});

describe('getMergedStyles (#302)', () => {
  let root: string;

  beforeEach(() => { root = mkProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('returns the bundled set when the user dir is empty', async () => {
    const merged = await getMergedStyles(root);
    expect(Object.keys(merged.styles).sort()).toEqual(Object.keys(BUNDLED_STYLES).sort());
    expect(merged.userIds.size).toBe(0);
  });

  it('user style appears alongside bundled set with userIds flagged', async () => {
    await fsp.mkdir(path.join(root, '.minerva/csl-styles'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/csl-styles/custom.csl'), MIN_CSL, 'utf-8');
    const merged = await getMergedStyles(root);
    expect(merged.styles['custom']).toBeTruthy();
    expect(merged.labels['custom']).toBe('My Custom Style');
    expect(merged.userIds.has('custom')).toBe(true);
    expect(merged.styles['apa']).toBeTruthy(); // bundled still present
  });

  it('user style with id matching a bundled one wins on collision', async () => {
    await fsp.mkdir(path.join(root, '.minerva/csl-styles'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/csl-styles/apa.csl'), MIN_CSL, 'utf-8');
    const merged = await getMergedStyles(root);
    // Override XML wins.
    expect(merged.styles['apa']).toBe(MIN_CSL);
    expect(merged.labels['apa']).toBe('My Custom Style');
    expect(merged.userIds.has('apa')).toBe(true);
  });
});

describe('getMergedLocales (#302)', () => {
  let root: string;

  beforeEach(() => { root = mkProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('user-imported en-GB locale joins the bundled en-US', async () => {
    const dir = path.join(root, '.minerva/csl-locales');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'en-GB.xml'), MIN_LOCALE, 'utf-8');
    const merged = await getMergedLocales(root);
    expect(merged.locales['en-US']).toBeTruthy();
    expect(merged.locales['en-GB']).toBe(MIN_LOCALE);
    expect(merged.userIds.has('en-GB')).toBe(true);
  });
});

describe('loadCitationAssets resolves user styles end-to-end (#302)', () => {
  let root: string;

  beforeEach(() => { root = mkProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('opts.styleId pointing at a user style resolves through the merged registry', async () => {
    await fsp.mkdir(path.join(root, '.minerva/csl-styles'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/csl-styles/custom.csl'), MIN_CSL, 'utf-8');
    const assets = await loadCitationAssets(root, { styleId: 'custom' });
    expect(assets.styleId).toBe('custom');
    expect(assets.style).toBe(MIN_CSL);
  });

  it('opts.styleId pointing at a still-unknown id falls back to default', async () => {
    const assets = await loadCitationAssets(root, { styleId: 'nonexistent' });
    expect(assets.styleId).toBe('apa');
  });
});
