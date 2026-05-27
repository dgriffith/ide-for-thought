/**
 * Resolve stub → full source (#107). Pure-function tests for
 * meta parsing + candidate scoring; the end-to-end flow goes
 * through the IPC with a mocked CrossRef.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  parseStubMeta,
  scoreCandidate,
  applyStubResolution,
} from '../../../src/main/sources/resolve-stub';
import {
  initGraph,
  indexSource,
  getSourceDetail,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import type { CrossrefSearchCandidate } from '../../../src/main/sources/api-adapters/crossref-search';

const STUB_TTL = `this: a thought:Article ;
    dc:title "Stochastic Parrots: On the Dangers of Bias" ;
    dc:creator "Bender, Emily M." ;
    dc:creator "Gebru, Timnit" ;
    dc:issued "2021"^^xsd:gYear ;
    thought:stubStatus "unresolved" ;
    thought:rawReference "Bender, E.M., Gebru, T. (2021). On the dangers of stochastic parrots." .
`;

describe('parseStubMeta', () => {
  it('extracts title / authors / year / raw from a stub meta.ttl', () => {
    const snap = parseStubMeta(STUB_TTL);
    expect(snap.title).toBe('Stochastic Parrots: On the Dangers of Bias');
    expect(snap.authors).toEqual(['Bender, Emily M.', 'Gebru, Timnit']);
    expect(snap.year).toBe('2021');
    expect(snap.rawReference).toContain('stochastic parrots');
  });

  it('returns null fields when the predicates are absent', () => {
    const snap = parseStubMeta(`this: a thought:Source ;\n    thought:stubStatus "unresolved" .\n`);
    expect(snap.title).toBe('');
    expect(snap.authors).toEqual([]);
    expect(snap.year).toBeNull();
    expect(snap.rawReference).toBeNull();
  });
});

function makeHit(work: Partial<CrossrefSearchCandidate['work']> & { DOI: string }, rawScore = 50): CrossrefSearchCandidate {
  return {
    work: {
      DOI: work.DOI,
      title: work.title ?? ['(untitled)'],
      author: work.author ?? [],
      issued: work.issued,
      'published-print': work['published-print'],
      'container-title': work['container-title'],
    },
    rawScore,
  };
}

describe('scoreCandidate', () => {
  const STUB = {
    title: 'On the dangers of stochastic parrots',
    authors: ['Bender, Emily M.', 'Gebru, Timnit'],
    year: '2021',
    rawReference: null,
  };

  it('scores a near-perfect match high', () => {
    const c = scoreCandidate(
      makeHit({
        DOI: '10.1145/3442188.3445922',
        title: ['On the dangers of stochastic parrots: Can language models be too big?'],
        author: [{ family: 'Bender' }, { family: 'Gebru' }],
        issued: { 'date-parts': [[2021]] },
      }),
      STUB,
    );
    expect(c).not.toBeNull();
    expect(c!.confidence).toBeGreaterThan(0.85);
    expect(c!.reasoning).toContain('title match');
    expect(c!.reasoning).toContain('year match');
  });

  it('scores a wrong-year same-title match below threshold', () => {
    const c = scoreCandidate(
      makeHit({
        DOI: '10.1/wrong-year',
        title: ['On the dangers of stochastic parrots: Can language models be too big?'],
        author: [{ family: 'Bender' }, { family: 'Gebru' }],
        issued: { 'date-parts': [[2018]] },
      }),
      STUB,
    );
    expect(c!.confidence).toBeLessThan(0.85);
    expect(c!.reasoning).toContain('year off');
  });

  it('scores an unrelated paper near zero', () => {
    const c = scoreCandidate(
      makeHit({
        DOI: '10.1/unrelated',
        title: ['Quantum chromodynamics in the deep infrared'],
        author: [{ family: 'Smith' }],
        issued: { 'date-parts': [[2021]] },
      }),
      STUB,
    );
    expect(c!.confidence).toBeLessThan(0.3);
  });

  it('returns null when the candidate has no DOI', () => {
    // CrossRef can return items without a DOI when searching loosely.
    const work = { title: ['No DOI'] };
    const hit = { work, rawScore: 1 } as unknown as CrossrefSearchCandidate;
    expect(scoreCandidate(hit, STUB)).toBeNull();
  });
});

describe('applyStubResolution', () => {
  let root: string;
  let ctx: ProjectContext;
  const sourceId = 'sha-stub123';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-resolve-stub-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    const dir = path.join(root, '.minerva', 'sources', sourceId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.ttl'), STUB_TTL);
    indexSource(ctx, sourceId, STUB_TTL);
  });
  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('rewrites meta.ttl with full metadata and flips stubStatus to resolved', async () => {
    // Stub fetch — we'd otherwise hit the real CrossRef.
    const stubFetch = (async () => new Response(JSON.stringify({
      message: {
        DOI: '10.1145/3442188.3445922',
        title: ['On the dangers of stochastic parrots'],
        author: [
          { family: 'Bender', given: 'Emily M.' },
          { family: 'Gebru', given: 'Timnit' },
        ],
        issued: { 'date-parts': [[2021]] },
        publisher: 'ACM',
        type: 'proceedings-article',
        URL: 'https://doi.org/10.1145/3442188.3445922',
      },
    }), { status: 200 })) as unknown as typeof fetch;

    const ok = await applyStubResolution(root, sourceId, '10.1145/3442188.3445922', { fetchImpl: stubFetch });
    expect(ok).toBe(true);

    const ttl = fs.readFileSync(path.join(root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
    expect(ttl).toContain('bibo:doi "10.1145/3442188.3445922"');
    expect(ttl).toContain('thought:stubStatus "resolved"');
    expect(ttl).not.toContain('"unresolved"');

    const detail = getSourceDetail(ctx, sourceId);
    expect(detail?.metadata.doi).toBe('10.1145/3442188.3445922');
    expect(detail?.metadata.stubStatus).toBe('resolved');
  });
});
