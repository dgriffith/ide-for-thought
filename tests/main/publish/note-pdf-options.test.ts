import { describe, it, expect } from 'vitest';
import {
  defaultsForLocale,
  resolveRenderOptions,
  toPrintToPdfArgs,
} from '../../../src/main/publish/exporters/note-pdf/options';

describe('defaultsForLocale (#249)', () => {
  it('picks Letter for en-US', () => {
    expect(defaultsForLocale('en-US')).toEqual({ pageSize: 'Letter' });
    expect(defaultsForLocale('en-us')).toEqual({ pageSize: 'Letter' });
  });

  it('picks Letter for en-CA', () => {
    expect(defaultsForLocale('en-CA')).toEqual({ pageSize: 'Letter' });
  });

  it('picks A4 for every other locale', () => {
    for (const loc of ['en-GB', 'en', 'fr-FR', 'de-DE', 'ja-JP', '']) {
      expect(defaultsForLocale(loc)).toEqual({ pageSize: 'A4' });
    }
  });

  it('normalises underscore-style locales like `en_US`', () => {
    expect(defaultsForLocale('en_US')).toEqual({ pageSize: 'Letter' });
  });
});

describe('resolveRenderOptions', () => {
  it('fills in sensible defaults', () => {
    const opts = resolveRenderOptions('en-US');
    expect(opts).toEqual({
      pageSize: 'Letter',
      margins: 'normal',
      orientation: 'portrait',
      scale: 100,
      headerFooter: false,
      title: undefined,
    });
  });

  it('respects user overrides', () => {
    const opts = resolveRenderOptions('en-GB', {
      pageSize: 'Legal',
      margins: 'narrow',
      orientation: 'landscape',
      scale: 150,
      headerFooter: true,
      title: 'My note',
    });
    expect(opts).toEqual({
      pageSize: 'Legal',
      margins: 'narrow',
      orientation: 'landscape',
      scale: 150,
      headerFooter: true,
      title: 'My note',
    });
  });

  it('clamps scale into [50, 200]', () => {
    expect(resolveRenderOptions('en-US', { scale: 10 }).scale).toBe(50);
    expect(resolveRenderOptions('en-US', { scale: 500 }).scale).toBe(200);
    expect(resolveRenderOptions('en-US', { scale: Number.NaN }).scale).toBe(50);
  });
});

describe('toPrintToPdfArgs', () => {
  const base = resolveRenderOptions('en-US');

  it('converts percent scale to a fraction', () => {
    expect(toPrintToPdfArgs({ ...base, scale: 150 }).scale).toBe(1.5);
  });

  it('applies margin presets (normal = 1in, narrow = 0.5in, wide = 1.5in, none = 0)', () => {
    expect(toPrintToPdfArgs({ ...base, margins: 'normal' }).margins.top).toBe(1.0);
    expect(toPrintToPdfArgs({ ...base, margins: 'narrow' }).margins.top).toBe(0.5);
    expect(toPrintToPdfArgs({ ...base, margins: 'wide' }).margins.top).toBe(1.5);
    expect(toPrintToPdfArgs({ ...base, margins: 'none' }).margins.top).toBe(0);
  });

  it('sets `landscape: true` only when orientation is landscape', () => {
    expect(toPrintToPdfArgs({ ...base, orientation: 'portrait' }).landscape).toBe(false);
    expect(toPrintToPdfArgs({ ...base, orientation: 'landscape' }).landscape).toBe(true);
  });

  it('enables document outline + background printing so the PDF has searchable text and keeps styled elements', () => {
    const args = toPrintToPdfArgs(base);
    expect(args.generateDocumentOutline).toBe(true);
    expect(args.printBackground).toBe(true);
  });

  it('emits header/footer HTML templates only when headerFooter is on', () => {
    const off = toPrintToPdfArgs(base);
    expect(off.displayHeaderFooter).toBe(false);
    expect(off.headerTemplate).toBeUndefined();
    expect(off.footerTemplate).toBeUndefined();

    const on = toPrintToPdfArgs({ ...base, headerFooter: true, title: 'Hello' });
    expect(on.displayHeaderFooter).toBe(true);
    expect(on.headerTemplate).toContain('<span class="title">Hello</span>');
    expect(on.footerTemplate).toContain('<span class="pageNumber">');
  });

  it('escapes HTML in header title so a note called "<script>" can\'t inject markup', () => {
    const args = toPrintToPdfArgs({ ...base, headerFooter: true, title: '<script>alert(1)</script>' });
    expect(args.headerTemplate).toContain('&lt;script&gt;');
    expect(args.headerTemplate).not.toContain('<script>alert');
  });
});
