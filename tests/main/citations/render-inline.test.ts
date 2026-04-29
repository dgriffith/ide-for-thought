import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { renderInlineCitations } from '../../../src/main/citations/render-inline';
import { setBibliographyStyleId } from '../../../src/main/project-config';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-citation-render-'));
}

async function seed(root: string): Promise<void> {
  // One source + one excerpt referencing it. Same fixture shape the
  // CSL integration tests use, so the renderer paths are exercised
  // end-to-end here too.
  await fsp.mkdir(path.join(root, '.minerva/sources/smith-2020'), { recursive: true });
  await fsp.writeFile(
    path.join(root, '.minerva/sources/smith-2020/meta.ttl'),
    `this: a thought:Article ;
  dc:title "On the Growth of Things" ;
  dc:creator "Smith, Jane" ;
  dc:creator "Jones, Bob" ;
  dc:issued "2020-04-15"^^xsd:date ;
  schema:inContainer "Journal of Things" ;
  bibo:doi "10.1234/foo.bar" .\n`,
    'utf-8',
  );
  await fsp.mkdir(path.join(root, '.minerva/excerpts'), { recursive: true });
  await fsp.writeFile(
    path.join(root, '.minerva/excerpts/ex-42.ttl'),
    `this: a thought:Excerpt ;
  thought:fromSource sources:smith-2020 ;
  thought:page 42 ;
  thought:citedText "Excerpt body" .\n`,
    'utf-8',
  );
}

describe('renderInlineCitations (#110)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await seed(root);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('returns one APA-style marker per ref in the same order', async () => {
    const result = await renderInlineCitations(root, [
      { kind: 'cite', id: 'smith-2020' },
      { kind: 'cite', id: 'smith-2020' },
    ]);
    expect(result.markers).toHaveLength(2);
    for (const m of result.markers) {
      expect(m).toMatch(/Smith/);
      expect(m).toMatch(/2020/);
    }
  });

  it('resolves [[quote::id]] through the excerpts map and emits a page locator', async () => {
    const result = await renderInlineCitations(root, [
      { kind: 'quote', id: 'ex-42' },
    ]);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]).toMatch(/42/);
  });

  it('omits a bibliography for author-date styles (APA default)', async () => {
    const result = await renderInlineCitations(root, [
      { kind: 'cite', id: 'smith-2020' },
    ]);
    expect(result.bibliography).toBeNull();
  });

  it('emits a numeric bibliography when the project style is IEEE', async () => {
    setBibliographyStyleId(root, 'ieee');
    const result = await renderInlineCitations(root, [
      { kind: 'cite', id: 'smith-2020' },
    ]);
    expect(result.styleId).toBe('ieee');
    // IEEE in-text marker is the numeric form.
    expect(result.markers[0]).toMatch(/\[1\]/);
    // Bibliography entries land for numeric styles.
    expect(result.bibliography).not.toBeNull();
    expect(result.bibliography?.length).toBeGreaterThan(0);
    expect(result.bibliography?.[0]).toContain('Smith');
  });

  it('reports unknown ids as missing and emits a [missing: id] marker', async () => {
    const result = await renderInlineCitations(root, [
      { kind: 'cite', id: 'never-existed' },
    ]);
    expect(result.missing).toContain('never-existed');
    expect(result.markers[0]).toContain('[missing: never-existed]');
  });

  it('falls back to APA when the configured style id is unknown', async () => {
    setBibliographyStyleId(root, 'not-a-real-style');
    const result = await renderInlineCitations(root, [
      { kind: 'cite', id: 'smith-2020' },
    ]);
    expect(result.styleId).toBe('apa');
    expect(result.markers[0]).toMatch(/Smith/);
  });

  it('preserves citation order across multiple refs (numeric)', async () => {
    setBibliographyStyleId(root, 'ieee');
    // First reference to smith-2020 → [1]; second reference → [1] again
    // (numeric styles dedupe by source id).
    const result = await renderInlineCitations(root, [
      { kind: 'cite', id: 'smith-2020' },
      { kind: 'quote', id: 'ex-42' },
    ]);
    expect(result.markers[0]).toMatch(/\[1\]/);
    // Numeric styles still surface the same source id with locator info.
    expect(result.markers[1]).toMatch(/\[1[^\]]*42[^\]]*\]/);
  });
});
