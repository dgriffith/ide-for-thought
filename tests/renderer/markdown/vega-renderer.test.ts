/**
 * @vitest-environment happy-dom
 *
 * Vega security guardrail (#829) — the spec-scan that refuses charts which
 * reach out to the network / filesystem. Inline `data.values` are the only
 * supported data source until #832 adds safe-path local-vault resolution, so
 * any `url` anywhere in the spec must be flagged. Tested at the pure-logic
 * level — no DOM or vega-embed round-trip.
 */

import { describe, it, expect } from 'vitest';
import { __test } from '../../../src/renderer/lib/markdown/vega-renderer';

const { findUrlRefs } = __test;

function urls(spec: unknown): string[] {
  const acc: string[] = [];
  findUrlRefs(spec, acc);
  return acc;
}

describe('findUrlRefs (vega remote-data guardrail)', () => {
  it('finds nothing in an inline-data spec', () => {
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: [{ a: 'A', b: 28 }, { a: 'B', b: 55 }] },
      mark: 'bar',
      encoding: { x: { field: 'a', type: 'nominal' }, y: { field: 'b', type: 'quantitative' } },
    };
    expect(urls(spec)).toEqual([]);
  });

  it('does NOT treat $schema or other non-url keys as a fetch', () => {
    // $schema is a value, not a `url` key — must not trip the guardrail.
    expect(urls({ $schema: 'https://vega.github.io/schema/vega-lite/v5.json' })).toEqual([]);
  });

  it('flags a top-level data.url remote fetch', () => {
    const spec = { data: { url: 'https://example.com/data.csv' }, mark: 'line' };
    expect(urls(spec)).toEqual(['https://example.com/data.csv']);
  });

  it('flags a url nested inside layers / concat', () => {
    const spec = {
      vconcat: [
        { data: { values: [] }, mark: 'bar' },
        { layer: [{ data: { url: 'http://evil.test/x.json' }, mark: 'point' }] },
      ],
    };
    expect(urls(spec)).toEqual(['http://evil.test/x.json']);
  });

  it('flags a url inside a transform lookup', () => {
    const spec = {
      data: { values: [] },
      transform: [{ lookup: 'id', from: { data: { url: 'https://cdn.test/lookup.json' }, key: 'id' } }],
    };
    expect(urls(spec)).toEqual(['https://cdn.test/lookup.json']);
  });

  it('flags relative and protocol-relative urls too (no url form supported yet)', () => {
    expect(urls({ data: { url: '/vault/data.csv' } })).toEqual(['/vault/data.csv']);
    expect(urls({ data: { url: '//cdn.test/x.json' } })).toEqual(['//cdn.test/x.json']);
  });

  it('flags an image mark url (also a remote fetch)', () => {
    const spec = {
      data: { values: [{ x: 1 }] },
      mark: { type: 'image', url: 'https://example.com/logo.png' },
    };
    expect(urls(spec)).toEqual(['https://example.com/logo.png']);
  });

  it('collects multiple urls across the spec', () => {
    const spec = {
      layer: [
        { data: { url: 'https://a.test/1.json' } },
        { data: { url: 'https://b.test/2.json' } },
      ],
    };
    expect(urls(spec).sort()).toEqual(['https://a.test/1.json', 'https://b.test/2.json']);
  });

  it('ignores a non-string url value', () => {
    // A spec where `url` is, say, a field encoding object — not a fetch target.
    expect(urls({ encoding: { url: { field: 'href', type: 'nominal' } } })).toEqual([]);
  });

  it('does not blow the stack / loop forever on deep nesting', () => {
    let deep: Record<string, unknown> = { url: 'https://leaf.test/x.json' };
    for (let i = 0; i < 200; i++) deep = { nested: deep };
    // Depth guard caps recursion at 64; a url below that is simply not reached.
    // The point is it returns without throwing.
    expect(() => urls(deep)).not.toThrow();
  });
});
