/**
 * Headless Vega-Lite / Vega → SVG export rendering (#831).
 *
 * Verifies the export pipeline turns chart fences into static images, holds the
 * #829 remote-data block at export time, and degrades gracefully (spec text +
 * note) rather than hard-failing the whole export on one bad chart.
 *
 * This actually invokes vega + vega-lite headlessly — the test resolves d3-path
 * via the dedupe in vitest.config.mts (the same fix the packaged main uses).
 */

import { describe, it, expect } from 'vitest';
import { renderVegaBlocks, hasVegaBlocks } from '../../../src/main/publish/vega-render';

const BAR = `\`\`\`vega-lite
{
  "data": { "values": [ { "a": "A", "b": 28 }, { "a": "B", "b": 55 } ] },
  "mark": "bar",
  "encoding": { "x": { "field": "a", "type": "nominal" }, "y": { "field": "b", "type": "quantitative" } }
}
\`\`\``;

describe('hasVegaBlocks', () => {
  it('detects vega-lite and vega fences, ignores everything else', () => {
    expect(hasVegaBlocks(BAR)).toBe(true);
    expect(hasVegaBlocks('```vega\n{}\n```')).toBe(true);
    expect(hasVegaBlocks('```python\nprint(1)\n```')).toBe(false);
    expect(hasVegaBlocks('no fences here')).toBe(false);
  });
});

describe('renderVegaBlocks', () => {
  it('returns content unchanged when there are no charts', async () => {
    const md = '# Title\n\nSome **text** and a `code` span.\n';
    expect(await renderVegaBlocks(md)).toBe(md);
  });

  it('replaces a vega-lite fence with an inline SVG data-URI image', async () => {
    const out = await renderVegaBlocks(`# Note\n\n${BAR}\n\nafter`);
    // The fence is gone…
    expect(out).not.toContain('```vega-lite');
    // …replaced by a markdown image carrying a base64 SVG.
    const m = out.match(/!\[chart\]\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)/);
    expect(m).toBeTruthy();
    const svg = Buffer.from(m![1], 'base64').toString('utf8');
    expect(svg).toContain('<svg');
    // Surrounding prose is preserved.
    expect(out).toContain('# Note');
    expect(out).toContain('after');
  });

  it('renders a full ```vega spec too', async () => {
    const vegaSpec = `\`\`\`vega
{
  "$schema": "https://vega.github.io/schema/vega/v5.json",
  "width": 100, "height": 100,
  "data": [ { "name": "t", "values": [ { "x": 1 }, { "x": 2 } ] } ],
  "marks": [ { "type": "symbol", "from": { "data": "t" }, "encode": { "enter": { "x": { "field": "x" }, "y": { "value": 10 } } } } ]
}
\`\`\``;
    const out = await renderVegaBlocks(vegaSpec);
    expect(out).toContain('data:image/svg+xml;base64,');
    expect(out).not.toContain('```vega');
  });

  it('blocks a remote-data spec at export, keeping the spec + a note (no fetch)', async () => {
    const remote = `\`\`\`vega-lite
{ "data": { "url": "https://example.com/data.csv" }, "mark": "line" }
\`\`\``;
    const out = await renderVegaBlocks(remote);
    expect(out).not.toContain('data:image'); // never rendered
    expect(out.toLowerCase()).toContain('remote data is disabled');
    // The spec is preserved (degraded to a code block), so nothing is lost.
    expect(out).toContain('```vega-lite');
    expect(out).toContain('https://example.com/data.csv');
  });

  it('degrades invalid JSON to spec text + a note instead of throwing', async () => {
    const bad = '```vega-lite\n{ not valid json }\n```';
    const out = await renderVegaBlocks(bad);
    expect(out.toLowerCase()).toContain('could not be rendered');
    expect(out).toContain('```vega-lite');
    expect(out).toContain('{ not valid json }');
  });

  it('degrades a structurally-broken spec without failing the whole export', async () => {
    // Valid JSON, but not a usable spec — vega throws during parse/render.
    const broken = '```vega-lite\n{ "mark": "bogus-mark-type", "data": { "values": [] } }\n```';
    const out = await renderVegaBlocks(broken);
    // Either it renders or it degrades — but it never throws and never drops the spec.
    expect(out).toContain('vega-lite');
  });

  it('handles multiple charts in one document independently', async () => {
    const doc = `${BAR}\n\ntext between\n\n${BAR}`;
    const out = await renderVegaBlocks(doc);
    const imgs = out.match(/data:image\/svg\+xml;base64,/g) ?? [];
    expect(imgs.length).toBe(2);
    expect(out).toContain('text between');
  });
});
