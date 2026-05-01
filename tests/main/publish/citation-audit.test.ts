/**
 * Audit-builder unit tests (#301).
 *
 * The audit groups every `[[cite::]]` / `[[quote::]]` reference in the
 * plan's notes by resolved source id, counts occurrences, and surfaces
 * missing ids. The preview dialog uses the result to show the user
 * exactly what'll be cited before they hit Export.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildCitationAudit } from '../../../src/main/publish/csl/audit';
import { resolvePlan } from '../../../src/main/publish/pipeline';
import { type CitationAssets } from '../../../src/main/publish/csl';
import type { CslItem } from '../../../src/main/publish/csl/source-to-csl';

function fakeAssets(
  items: Record<string, Pick<CslItem, 'title'>>,
  excerpts: Record<string, { sourceId: string; locator?: string }> = {},
): CitationAssets {
  const itemMap = new Map<string, CslItem>(
    Object.entries(items).map(([id, partial]) => [id, { id, type: 'article', ...partial }]),
  );
  return {
    styleId: 'apa',
    localeId: 'en-US',
    style: '<style/>',
    locale: '<locale/>',
    items: itemMap,
    excerpts: new Map(Object.entries(excerpts)),
    knownSourceIds: [...itemMap.keys()],
    createRenderer: () => { throw new Error('not used in audit tests'); },
  };
}

describe('buildCitationAudit (#301)', () => {
  it('groups [[cite::]] occurrences by source and counts them', () => {
    const assets = fakeAssets({
      'foo-2020': { title: 'Foo Studies' },
      'bar-2021': { title: 'Bar Considered' },
    });
    const notes = [
      { relativePath: 'a.md', content: 'See [[cite::foo-2020]] and [[cite::foo-2020]] again.' },
      { relativePath: 'b.md', content: 'Per [[cite::bar-2021]], we have a result.' },
    ];
    const audit = buildCitationAudit(notes, assets);
    expect(audit.bySource).toEqual([
      { sourceId: 'foo-2020', title: 'Foo Studies', refCount: 2 },
      { sourceId: 'bar-2021', title: 'Bar Considered', refCount: 1 },
    ]);
    expect(audit.missing).toEqual([]);
  });

  it('resolves [[quote::]] through the excerpt to its parent source', () => {
    const assets = fakeAssets(
      { 'brooks-1986': { title: 'No Silver Bullet' } },
      { 'ex-essence': { sourceId: 'brooks-1986', locator: '11' } },
    );
    const notes = [
      { relativePath: 'note.md', content: '[[quote::ex-essence]] and [[cite::brooks-1986]].' },
    ];
    const audit = buildCitationAudit(notes, assets);
    // Both refs collapse onto the same Brooks bucket.
    expect(audit.bySource).toEqual([
      { sourceId: 'brooks-1986', title: 'No Silver Bullet', refCount: 2 },
    ]);
    expect(audit.missing).toEqual([]);
  });

  it('surfaces missing cite ids', () => {
    const assets = fakeAssets({ 'foo-2020': { title: 'Foo' } });
    const notes = [
      { relativePath: 'a.md', content: '[[cite::nope]] [[cite::foo-2020]] [[cite::nope]]' },
    ];
    const audit = buildCitationAudit(notes, assets);
    expect(audit.missing).toEqual([
      { id: 'nope', kind: 'cite', refCount: 2 },
    ]);
    expect(audit.bySource).toEqual([
      { sourceId: 'foo-2020', title: 'Foo', refCount: 1 },
    ]);
  });

  it('surfaces missing quote ids (excerpt not in project)', () => {
    const assets = fakeAssets({ 'foo-2020': { title: 'Foo' } }, {});
    const notes = [
      { relativePath: 'a.md', content: '[[quote::ghost-excerpt]]' },
    ];
    const audit = buildCitationAudit(notes, assets);
    expect(audit.missing).toEqual([
      { id: 'ghost-excerpt', kind: 'quote', refCount: 1 },
    ]);
    expect(audit.bySource).toEqual([]);
  });

  it('surfaces a missing source even when the excerpt itself is loaded', () => {
    // Excerpt's parent source got deleted but the excerpt TTL still exists.
    const assets = fakeAssets(
      {}, // no sources at all
      { 'orphan-ex': { sourceId: 'gone-source', locator: '5' } },
    );
    const notes = [
      { relativePath: 'a.md', content: '[[quote::orphan-ex]]' },
    ];
    const audit = buildCitationAudit(notes, assets);
    expect(audit.missing).toEqual([
      // Surfaced as the *source* id so the user knows which ref is the
      // load-bearing one to fix.
      { id: 'gone-source', kind: 'cite', refCount: 1 },
    ]);
  });

  it('orders bySource by refCount desc, then sourceId asc for ties', () => {
    const assets = fakeAssets({
      a: { title: 'A' },
      b: { title: 'B' },
      c: { title: 'C' },
    });
    const notes = [
      { relativePath: 'n.md', content: '[[cite::c]] [[cite::a]] [[cite::a]] [[cite::b]] [[cite::b]]' },
    ];
    const audit = buildCitationAudit(notes, assets);
    expect(audit.bySource.map((e) => e.sourceId)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to the bare id when the loaded source has no title', () => {
    const assets = fakeAssets({ 'untitled-source': {} });
    const notes = [{ relativePath: 'n.md', content: '[[cite::untitled-source]]' }];
    const audit = buildCitationAudit(notes, assets);
    expect(audit.bySource[0].title).toBe('untitled-source');
  });

  it('respects scanCitations\' bibliography-block strip — refs inside it don\'t double-count', () => {
    const assets = fakeAssets({ 'foo-2020': { title: 'Foo' } });
    const notes = [{
      relativePath: 'n.md',
      content: '[[cite::foo-2020]]\n\n<!-- minerva:bibliography -->\n[[cite::foo-2020]]\n<!-- /minerva:bibliography -->',
    }];
    const audit = buildCitationAudit(notes, assets);
    expect(audit.bySource).toEqual([
      { sourceId: 'foo-2020', title: 'Foo', refCount: 1 },
    ]);
  });

  it('handles empty input cleanly', () => {
    const audit = buildCitationAudit([], fakeAssets({}));
    expect(audit.bySource).toEqual([]);
    expect(audit.missing).toEqual([]);
  });
});

describe('audit integrates with resolvePlan against a real fixture (#301)', () => {
  let root: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-audit-'));
    await fsp.mkdir(path.join(root, '.minerva/sources/foo-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/foo-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Foo Studies" ;
  dc:creator "Foo, Alice" ;
  dc:issued "2020"^^xsd:gYear .\n`,
      'utf-8',
    );
    await fsp.mkdir(path.join(root, '.minerva/excerpts'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/excerpts/ex-foo.ttl'),
      `this: a thought:Excerpt ;
  thought:fromSource sources:foo-2020 ;
  thought:page 7 .\n`,
      'utf-8',
    );
    await fsp.writeFile(path.join(root, 'note.md'),
      'See [[cite::foo-2020]] and [[quote::ex-foo]] but also [[cite::missing-id]].\n',
      'utf-8',
    );
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('end-to-end: plan + audit reports cited sources and the missing id', async () => {
    const plan = await resolvePlan(root, { kind: 'project' });
    expect(plan.citations).toBeDefined();
    expect(plan.citations!.styleId).toBe('apa'); // default fallback
    expect(plan.citations!.localeId).toBe('en-US');

    const audit = buildCitationAudit(plan.inputs, plan.citations!);
    expect(audit.bySource).toEqual([
      // foo-2020 gets 2 refs: the [[cite::]] + the [[quote::]] resolving through ex-foo.
      { sourceId: 'foo-2020', title: 'Foo Studies', refCount: 2 },
    ]);
    expect(audit.missing).toEqual([
      { id: 'missing-id', kind: 'cite', refCount: 1 },
    ]);
  });

  it('honours the citationStyle option through resolvePlan', async () => {
    const plan = await resolvePlan(root, { kind: 'project' }, { citationStyle: 'mla' });
    expect(plan.citations!.styleId).toBe('mla');
  });

  it('falls back to default style for unknown ids', async () => {
    const plan = await resolvePlan(root, { kind: 'project' }, { citationStyle: 'no-such-style' });
    expect(plan.citations!.styleId).toBe('apa');
  });
});
