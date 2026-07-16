/**
 * @vitest-environment jsdom
 *
 * Batched cite/quote hydration (perf #1114). The former per-element resolvers
 * issued one `api.graph.query` per `.cite-link` / `.quote-link`; these tests pin
 * that a whole batch now resolves in a SINGLE IPC round-trip, that metadata is
 * applied to every link, and that a re-run served from cache issues no IPC.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { graph: { query: (sparql: string) => queryMock(sparql) } },
}));

import {
  resolveCiteLabels,
  resolveQuoteLabels,
  type CitationRenderDeps,
} from '../../../src/renderer/lib/preview/citation-render';
import type { CiteMeta, QuoteMeta } from '../../../src/renderer/lib/preview/cite-meta';

function makeDeps(): CitationRenderDeps {
  const root = document.createElement('div');
  return {
    previewEl: root,
    citeMetaCache: new Map<string, CiteMeta>(),
    quoteMetaCache: new Map<string, QuoteMeta>(),
    queryPrefixes: '',
    setBibliographyEntries: () => {},
  };
}

/** A `.cite-link` element with the `.link-display` span the resolver requires. */
function citeLink(sourceId: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'cite-link';
  el.dataset.sourceId = sourceId;
  const disp = document.createElement('span');
  disp.className = 'link-display';
  el.appendChild(disp);
  return el;
}

function quoteLink(excerptId: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'quote-link';
  el.dataset.excerptId = excerptId;
  const disp = document.createElement('span');
  disp.className = 'link-display';
  el.appendChild(disp);
  return el;
}

beforeEach(() => queryMock.mockReset());

describe('resolveCiteLabels (batched, #1114)', () => {
  it('resolves N cite links in a single IPC call', async () => {
    queryMock.mockResolvedValue({
      results: [
        { sid: 's1', title: 'First', creator: 'Ada', issued: '2020-01-01' },
        { sid: 's2', title: 'Second', creator: 'Bob', issued: '2021-06-01' },
      ],
    });
    const deps = makeDeps();
    const els = [citeLink('s1'), citeLink('s2'), citeLink('s1')]; // s1 twice

    await resolveCiteLabels(deps, els);

    expect(queryMock).toHaveBeenCalledTimes(1);
    // One VALUES query carrying both distinct ids.
    const sparql = queryMock.mock.calls[0]![0] as string;
    expect(sparql).toContain('VALUES ?sid');
    expect(sparql).toContain('"s1"');
    expect(sparql).toContain('"s2"');

    // Every element (including the duplicate s1) got tooltip metadata.
    for (const el of els) {
      expect(el.dataset.tooltipKind).toBe('cite');
    }
    const meta1 = JSON.parse(els[0]!.dataset.tooltipPayload!) as CiteMeta;
    expect(meta1.title).toBe('First');
    expect(meta1.creators).toEqual(['Ada']);
    expect(meta1.year).toBe('2020');
    // The duplicate points at the same source.
    expect(JSON.parse(els[2]!.dataset.tooltipPayload!).title).toBe('First');
  });

  it('serves cached ids without any IPC on a second pass', async () => {
    queryMock.mockResolvedValue({ results: [{ sid: 's1', title: 'First', creator: 'Ada' }] });
    const deps = makeDeps();

    await resolveCiteLabels(deps, [citeLink('s1')]);
    expect(queryMock).toHaveBeenCalledTimes(1);

    // A fresh element for the same, now-cached source → no new query.
    await resolveCiteLabels(deps, [citeLink('s1')]);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('does not query when there are no cite links', async () => {
    await resolveCiteLabels(makeDeps(), []);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('resolveQuoteLabels (batched, #1114)', () => {
  it('resolves N quote links in a single IPC call', async () => {
    queryMock.mockResolvedValue({
      results: [
        { eid: 'e1', citedText: 'quote one', sourceTitle: 'Src', page: '3' },
        { eid: 'e2', citedText: 'quote two' },
      ],
    });
    const deps = makeDeps();
    const els = [quoteLink('e1'), quoteLink('e2')];

    await resolveQuoteLabels(deps, els);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const sparql = queryMock.mock.calls[0]![0] as string;
    expect(sparql).toContain('VALUES ?eid');
    const meta1 = JSON.parse(els[0]!.dataset.tooltipPayload!) as QuoteMeta;
    expect(meta1.citedText).toBe('quote one');
    expect(meta1.page).toBe('3');
    expect(JSON.parse(els[1]!.dataset.tooltipPayload!).citedText).toBe('quote two');
  });
});
