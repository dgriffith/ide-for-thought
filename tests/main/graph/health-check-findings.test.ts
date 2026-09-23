/**
 * What `runAllChecks` REPORTS, on one project carrying every kind of problem
 * at once (#2208 C1b/C1c).
 *
 * The other health-check suites each exercise one check on a project built to
 * trip exactly that check. That is the right shape for "does this check work",
 * and the wrong shape for "did making the sweep cheaper change what it finds" —
 * a consolidation that accidentally makes one check's WHERE clause shadow
 * another's leaves every single-check suite green.
 *
 * So this file states one fixture and the complete set of findings it should
 * produce, per type. It was written and run BEFORE the C1b/C1c changes and is
 * unchanged by them: that is the whole point of it, and the reason it asserts
 * exact sets rather than `toHaveLength` — a coverage regression has to be
 * visible as a diff here.
 *
 * It deliberately says nothing about timing or query counts. Those gates live
 * in `health-check-query-count.test.ts`; this one is the correctness half, and
 * a count gate is worthless without it (a sweep that issues zero queries
 * satisfies "fewer than 17" perfectly).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexNote, indexSource } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { findOrphanedInlineAssets } from '../../../src/main/notebase/asset-references';
import { DEFAULT_INSPECTION_SETTINGS } from '../../../src/shared/inspections';
import { INLINE_ASSET_DIR } from '../../../src/shared/asset-paths';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const DAY = 86_400_000;
const DEPS = { findOrphanedAssets: findOrphanedInlineAssets };

function meta(extra: string): string {
  return `this: a thought:Article ;\n${extra}    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .\n`;
}

describe('runAllChecks — the findings on a project with one of everything (#2208)', () => {
  const project = useGraphProject('minerva-health-findings-');
  let root: string;
  let ctx: ProjectContext;

  function addSource(id: string, extra: string, ageDays = 0): void {
    const dir = path.join(root, '.minerva', 'sources', id);
    fs.mkdirSync(dir, { recursive: true });
    const ttl = meta(extra);
    const file = path.join(dir, 'meta.ttl');
    fs.writeFileSync(file, ttl);
    if (ageDays > 0) {
      const old = new Date(Date.now() - ageDays * DAY);
      fs.utimesSync(file, old, old);
    }
    indexSource(ctx, id, ttl);
  }

  beforeEach(async () => {
    root = project.root;
    ctx = project.ctx;

    // ── Sources ──────────────────────────────────────────────────────────
    addSource('complete', '    dc:title "Complete" ;\n    dc:creator "Smith" ;\n    minerva:readStatus "read" ;\n');
    addSource('no-title', '    dc:creator "Alice" ;\n');
    addSource('no-author', '    dc:title "Solo" ;\n');
    addSource('bad-doi', '    dc:title "Bad DOI" ;\n    dc:creator "Jones" ;\n    bibo:doi "nonsense" ;\n');
    addSource('dup-a', '    dc:title "Dup A" ;\n    dc:creator "X" ;\n    bibo:doi "10.1145/Foo" ;\n    bibo:uri "https://example.com/p" ;\n');
    addSource('dup-b', '    dc:title "Dup B" ;\n    dc:creator "Y" ;\n    bibo:doi "10.1145/foo" ;\n    bibo:uri "https://example.com/p/" ;\n');
    addSource('cited-unread', '    dc:title "Cited Unread" ;\n    dc:creator "Z" ;\n');
    addSource('aged-stub', '    dc:title "Aged Stub" ;\n    thought:stubStatus "unresolved" ;\n', 45);
    addSource('fresh-stub', '    dc:title "Fresh Stub" ;\n    thought:stubStatus "unresolved" ;\n');

    // ── Notes ────────────────────────────────────────────────────────────
    const ancient = new Date(Date.now() - 400 * DAY).toISOString();
    await indexNote(ctx, 'target.md', '# Target\n\n## Real Heading\n\ntext\n');
    await indexNote(ctx, 'stale.md', `---\ntitle: Stale One\nmodified: ${ancient}\n---\n\n# Stale One\n\ntext\n`);
    await indexNote(
      ctx,
      'links.md',
      '# Links\n\n[[target]] and [[target#real-heading]] are fine.\n\n'
      + '[[no-such-note]] is not.\n\n[[target#no-such-heading]] is not.\n\n'
      + '[[cite::no-such-source]] is not.\n\n[[cite::cited-unread]] is fine.\n',
    );

    // ── An orphaned inline asset, and a referenced one ───────────────────
    const assetDir = path.join(root, INLINE_ASSET_DIR);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, 'aaaa1111-orphan.png'), Buffer.alloc(2048));
    fs.writeFileSync(path.join(assetDir, 'bbbb2222-kept.png'), Buffer.alloc(1024));
    // The asset scan reads DISK, not the graph, so this note has to exist as a
    // file as well as be indexed.
    const usesImage = `# Uses\n\n![kept](${INLINE_ASSET_DIR}/bbbb2222-kept.png)\n`;
    fs.writeFileSync(path.join(root, 'uses-image.md'), usesImage);
    await indexNote(ctx, 'uses-image.md', usesImage);
  });

  /** Findings of `type`, as a sorted list of labels — order-independent. */
  async function labelsOf(type: string): Promise<string[]> {
    const all = await runAllChecks(ctx, DEFAULT_INSPECTION_SETTINGS, DEPS);
    return all.filter((i) => i.type === type).map((i) => i.nodeLabel).sort();
  }

  it('reports exactly the sources missing bibliographic details', async () => {
    expect(await labelsOf('source_missing_metadata')).toEqual(['Solo', 'no-title']);
  });

  it('reports exactly the malformed DOI', async () => {
    expect(await labelsOf('invalid_doi')).toEqual(['Bad DOI']);
  });

  it('reports exactly the duplicate DOI and the duplicate URL', async () => {
    const all = await runAllChecks(ctx, DEFAULT_INSPECTION_SETTINGS, DEPS);
    const doi = all.filter((i) => i.type === 'source_duplicate_doi');
    const uri = all.filter((i) => i.type === 'source_duplicate_uri');
    expect(doi).toHaveLength(1);
    expect(uri).toHaveLength(1);
    expect(doi[0]!.message).toContain('10.1145/foo');
    expect(doi[0]!.message).toContain('dup-a');
    expect(doi[0]!.message).toContain('dup-b');
    expect(doi[0]!.fix && 'sourceIds' in doi[0]!.fix ? [...doi[0]!.fix.sourceIds].sort() : [])
      .toEqual(['dup-a', 'dup-b']);
    expect(uri[0]!.message).toContain('https://example.com/p');
  });

  it('reports exactly the cited-but-unread source — not the read one, not the stub', async () => {
    expect(await labelsOf('source_cited_unread')).toEqual(['Cited Unread']);
  });

  it('reports exactly the aged stub, not the fresh one', async () => {
    const all = await runAllChecks(ctx, DEFAULT_INSPECTION_SETTINGS, DEPS);
    const aged = all.filter((i) => i.type === 'stub_aged');
    expect(aged.map((i) => i.nodeLabel)).toEqual(['Aged Stub']);
    expect(aged[0]!.fix).toEqual({ kind: 'resolve-source-stub', label: 'Resolve source', sourceId: 'aged-stub' });
  });

  it('reports exactly the stale note', async () => {
    expect(await labelsOf('stale_note')).toEqual(['Stale One']);
  });

  it('reports exactly the broken note link, anchor and citation', async () => {
    const all = await runAllChecks(ctx, DEFAULT_INSPECTION_SETTINGS, DEPS);
    const msg = (t: string) => all.filter((i) => i.type === t).map((i) => i.message);
    expect(msg('broken_note_link')).toHaveLength(1);
    expect(msg('broken_note_link')[0]).toContain('no-such-note');
    expect(msg('broken_anchor_link')).toHaveLength(1);
    expect(msg('broken_anchor_link')[0]).toContain('no-such-heading');
    expect(msg('broken_cite_quote')).toHaveLength(1);
    expect(msg('broken_cite_quote')[0]).toContain('no-such-source');
  });

  it('reports exactly the orphaned image, and leaves the referenced one alone', async () => {
    expect(await labelsOf('unreferenced_image')).toEqual(['aaaa1111-orphan.png']);
  });

});

/**
 * The other half of every assertion above: the findings come from the fixture's
 * problems, not from the sweep reporting unconditionally. Without this, a check
 * that flagged every source would still pass the sets above.
 */
describe('runAllChecks — a clean project reports nothing (#2208)', () => {
  const project = useGraphProject('minerva-health-clean-');

  it('finds no problems in a project that has none', async () => {
    const ctx = project.ctx;
    const ttl = meta('    dc:title "Fine" ;\n    dc:creator "Smith" ;\n    minerva:readStatus "read" ;\n    bibo:doi "10.1145/ok" ;\n');
    const dir = path.join(project.root, '.minerva', 'sources', 'fine');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl);
    indexSource(ctx, 'fine', ttl);
    await indexNote(ctx, 'a.md', '# A\n\n## H\n\n[[b]]\n');
    await indexNote(ctx, 'b.md', '# B\n\n[[a#h]] and [[cite::fine]]\n');

    const all = await runAllChecks(ctx, DEFAULT_INSPECTION_SETTINGS, DEPS);
    expect(all).toEqual([]);
  });
});
