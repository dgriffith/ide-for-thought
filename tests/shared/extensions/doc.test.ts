/**
 * `docs/extension-points.md` is the catalog, rendered (#2620). The committed
 * page must equal what `renderExtensionPointsDoc` produces now — regenerate
 * with `pnpm test tests/shared/extensions/doc.test.ts -u` after changing the
 * catalog — and, read on its own, every extension point has a section and
 * every section names a real point. Same arrangement as
 * architecture-ratchets-doc.test.ts: a page nobody checks becomes a page that
 * tells you something false with confidence.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderExtensionPointsDoc } from '../../../src/shared/extensions/doc';
import { EXTENSION_POINTS } from '../../../src/shared/extensions/points';

const DOC = path.resolve(__dirname, '..', '..', '..', 'docs', 'extension-points.md');

describe('docs/extension-points.md (#2620)', () => {
  it('is the catalog, rendered', async () => {
    await expect(renderExtensionPointsDoc()).toMatchFileSnapshot(DOC);
  });

  it('has a section for every extension point, and none for anything else', () => {
    const page = fs.readFileSync(DOC, 'utf-8');
    const sections = [...page.matchAll(/^## `([a-z0-9-]+)` — /gm)].map((m) => m[1]);
    expect(sections.sort()).toEqual(EXTENSION_POINTS.map((p) => p.id).sort());
  });

  it('every link on the page resolves', () => {
    const page = fs.readFileSync(DOC, 'utf-8');
    const docsDir = path.dirname(DOC);
    const broken = [...page.matchAll(/\]\(([^)#]+)\)/g)]
      .map((m) => m[1]!)
      .filter((href) => !/^https?:/.test(href) && !fs.existsSync(path.resolve(docsDir, href)));
    expect(broken).toEqual([]);
    // In-page anchors point at a heading.
    const anchors = [...page.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]!);
    const headings = new Set([...page.matchAll(/^## (.+)$/gm)].map((m) =>
      m[1]!.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-')));
    expect(anchors.filter((a) => !headings.has(a))).toEqual([]);
  });
});
