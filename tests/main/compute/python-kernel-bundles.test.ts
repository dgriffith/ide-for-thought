/**
 * MIME-bundle → CellOutput translation in the Python kernel adapter
 * (#243). Pure unit tests for `bundleToOutput`, no kernel spawn needed.
 */

import { describe, it, expect } from 'vitest';
import { bundleToOutput } from '../../../src/main/compute/python-kernel';

describe('bundleToOutput (#243)', () => {
  it('application/vnd.minerva.dataframe+json → table with truncation flags', () => {
    const out = bundleToOutput({
      mime: 'application/vnd.minerva.dataframe+json',
      data: {
        columns: ['a', 'b'],
        rows: [[1, 2], [3, 4]],
        totalRows: 5000,
        truncated: true,
      },
    });
    expect(out.type).toBe('table');
    if (out.type !== 'table') return;
    expect(out.columns).toEqual(['a', 'b']);
    expect(out.rows).toEqual([[1, 2], [3, 4]]);
    expect(out.totalRows).toBe(5000);
    expect(out.truncated).toBe(true);
  });

  it('image/png → image with mime + base64 data preserved', () => {
    const data = 'iVBORw0KGgoAAAANS...';
    const out = bundleToOutput({ mime: 'image/png', data });
    expect(out.type).toBe('image');
    if (out.type !== 'image') return;
    expect(out.mime).toBe('image/png');
    expect(out.data).toBe(data);
  });

  it('image/svg+xml → image with raw markup preserved', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const out = bundleToOutput({ mime: 'image/svg+xml', data: svg });
    expect(out.type).toBe('image');
    if (out.type !== 'image') return;
    expect(out.mime).toBe('image/svg+xml');
    expect(out.data).toBe(svg);
  });

  it('text/html → html', () => {
    const out = bundleToOutput({ mime: 'text/html', data: '<b>hello</b>' });
    expect(out.type).toBe('html');
    if (out.type !== 'html') return;
    expect(out.html).toBe('<b>hello</b>');
  });

  it('text/plain → text', () => {
    const out = bundleToOutput({ mime: 'text/plain', data: 'fallback repr' });
    expect(out.type).toBe('text');
    if (out.type !== 'text') return;
    expect(out.value).toBe('fallback repr');
  });

  it('application/json → json (preserves nested data)', () => {
    const data = { foo: [1, 2, { bar: 'baz' }] };
    const out = bundleToOutput({ mime: 'application/json', data });
    expect(out.type).toBe('json');
    if (out.type !== 'json') return;
    expect(out.value).toEqual(data);
  });

  it('unknown mime falls through to json with the raw bundle preserved', () => {
    const raw = { mime: 'application/vnd.example+wat', data: { x: 1 } };
    const out = bundleToOutput(raw);
    expect(out.type).toBe('json');
    if (out.type !== 'json') return;
    expect(out.value).toEqual(raw);
  });

  it('non-bundle (bare value) falls back to json wrapping (back-compat with pre-#243)', () => {
    const out = bundleToOutput(42);
    expect(out.type).toBe('json');
    if (out.type !== 'json') return;
    expect(out.value).toBe(42);
  });

  it('null and undefined route through the bare-value path', () => {
    expect(bundleToOutput(null)).toEqual({ type: 'json', value: null });
    expect(bundleToOutput(undefined)).toEqual({ type: 'json', value: undefined });
  });

  it('object missing the mime field falls through (defensive)', () => {
    const out = bundleToOutput({ data: 'no-mime' });
    expect(out.type).toBe('json');
  });
});
