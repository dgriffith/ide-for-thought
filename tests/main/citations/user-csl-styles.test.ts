/**
 * The preview renders citations in the project's configured style, including
 * a user-imported one (#2314).
 *
 * #302 added user CSL styles under `.minerva/csl-styles/<id>.csl`, with an
 * explicit merge policy — user entries win on id collision — implemented in
 * `getMergedStyles` and honoured by `loadCitationAssets`, the export pipeline,
 * and the settings picker. The preview handler was resolving the project's
 * style against `BUNDLED_STYLES` alone, so it had its own, narrower idea of
 * which styles exist.
 *
 * The invariant these tests pin is not "the handler consults the merged
 * registry" — it is that **the preview and an export agree about which style a
 * note is in**. That is the thing a user can actually observe, and it is
 * asserted directly by rendering both ways and comparing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderInlineCitations } from '../../../src/main/citations/render-inline';
import { loadCitationAssets } from '../../../src/main/publish/csl';
import { setBibliographyStyleId } from '../../../src/main/project-config';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

/**
 * A minimal but real CSL style whose in-text citation is an unmistakable
 * marker, so "which style rendered this" needs no interpretation.
 */
function cslStyle(opts: { title: string; marker: string; numeric?: boolean }): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>${opts.title}</title>
    <id>http://example.com/${opts.title}</id>
    ${opts.numeric ? '<category citation-format="numeric"/>' : '<category citation-format="author-date"/>'}
  </info>
  <citation>
    <layout prefix="[" suffix="]">
      <text value="${opts.marker}"/>
    </layout>
  </citation>
  <bibliography>
    <layout>
      <text value="${opts.marker}-bib"/>
    </layout>
  </bibliography>
</style>`;
}

function writeUserStyle(root: string, id: string, xml: string): void {
  const dir = path.join(root, '.minerva', 'csl-styles');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.csl`), xml, 'utf-8');
}

function seedSource(root: string): void {
  const dir = path.join(root, '.minerva', 'sources', 'smith-2020');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'meta.ttl'),
    'this: a thought:Article ;\n  dc:title "On Things" ;\n  dc:creator "Smith, Jane" ;\n'
      + '  dc:issued "2020-04-15"^^xsd:date .\n',
    'utf-8',
  );
}

const CITE = [{ kind: 'cite' as const, id: 'smith-2020' }];

/** What an EXPORT renders for the same source in the same project. */
async function exportMarker(ctx: ProjectContext, styleId: string): Promise<string> {
  const assets = await loadCitationAssets(ctx.rootPath, { styleId });
  return assets.createRenderer().renderCitation('smith-2020');
}

describe('a user style with its own id (#2314)', () => {
  const project = useGraphProject('minerva-user-csl-');
  let ctx: ProjectContext;

  beforeEach(() => {
    ctx = project.ctx;
    seedSource(project.root);
    writeUserStyle(project.root, 'house-style', cslStyle({ title: 'House Style', marker: 'HOUSE' }));
    setBibliographyStyleId(project.root, 'house-style');
  });

  it('the preview uses it', async () => {
    // Before #2314 this rendered APA — `house-style` is not in BUNDLED_STYLES,
    // so the handler silently fell back to the default.
    const result = await renderInlineCitations(ctx, CITE);
    expect(result.markers[0], 'the preview ignored the project\'s configured style')
      .toContain('HOUSE');
  });

  it('and reports the style it actually used', async () => {
    // `styleId` is surfaced to the UI (#301). Reporting `apa` while rendering
    // something else would be worse than either alone.
    const result = await renderInlineCitations(ctx, CITE);
    expect(result.styleId).toBe('house-style');
  });

  it('the preview and an export agree', async () => {
    // The invariant that matters to a user.
    const preview = (await renderInlineCitations(ctx, CITE)).markers[0]!;
    expect(preview).toContain('HOUSE');
    expect(await exportMarker(ctx, 'house-style')).toContain('HOUSE');
  });

  it('a numeric user style still gets a preview bibliography', async () => {
    // `isNumericStyle` used to read `BUNDLED_STYLES[styleId]`, which for a
    // user id is `undefined` — the non-null assertion there would have thrown
    // once the style actually resolved. It reads the resolved XML now.
    writeUserStyle(
      project.root,
      'house-numeric',
      cslStyle({ title: 'House Numeric', marker: 'N', numeric: true }),
    );
    setBibliographyStyleId(project.root, 'house-numeric');

    const result = await renderInlineCitations(ctx, CITE);
    expect(result.styleId).toBe('house-numeric');
    expect(result.bibliography, 'a numeric style must yield a bibliography').not.toBeNull();
    expect(result.bibliography!.length).toBeGreaterThan(0);
  });
});

describe('a user style overriding a bundled id', () => {
  const project = useGraphProject('minerva-user-csl-override-');
  let ctx: ProjectContext;

  beforeEach(() => {
    ctx = project.ctx;
    seedSource(project.root);
    writeUserStyle(project.root, 'apa', cslStyle({ title: 'My APA', marker: 'MYAPA' }));
    setBibliographyStyleId(project.root, 'apa');
  });

  it('the override is applied — as it already was', async () => {
    // Worth pinning precisely, because #2314 claims this case showed "the
    // bundled APA while every export shows the user's variant", and that is
    // NOT what the code did. `loadCitationAssets` resolves `apa` against the
    // MERGED registry, where the user's file wins, so the override was always
    // being rendered. Only the numeric-format probe below read the wrong file.
    const result = await renderInlineCitations(ctx, CITE);
    expect(result.markers[0]).toContain('MYAPA');
    expect(await exportMarker(ctx, 'apa')).toContain('MYAPA');
  });

  it('the numeric-format decision follows the override too', async () => {
    // This is the half that genuinely was broken for an override: the style
    // used came from the merged registry, while `isNumericStyle` read
    // `BUNDLED_STYLES['apa']` — so a user file that changes the citation
    // format got the bundled file's answer, and the preview bibliography
    // appeared or vanished according to a style nobody was using.
    writeUserStyle(
      project.root,
      'apa',
      cslStyle({ title: 'My APA Numeric', marker: 'MYAPA', numeric: true }),
    );
    const result = await renderInlineCitations(ctx, CITE);
    expect(result.markers[0]).toContain('MYAPA');
    expect(result.bibliography, 'numeric detection read the bundled style, not the override')
      .not.toBeNull();
  });
});

describe('the bundled styles still behave', () => {
  const project = useGraphProject('minerva-user-csl-bundled-');

  it('an unset style falls back to the default', async () => {
    const ctx = project.ctx;
    seedSource(project.root);
    const result = await renderInlineCitations(ctx, CITE);
    expect(result.styleId).toBe('apa');
    expect(result.markers[0]).toMatch(/Smith/);
  });

  it('an unknown style id falls back rather than throwing', async () => {
    // The fallback the handler used to own itself now lives in
    // `loadCitationAssets`; it has to still happen.
    const ctx = project.ctx;
    seedSource(project.root);
    setBibliographyStyleId(project.root, 'no-such-style');
    const result = await renderInlineCitations(ctx, CITE);
    expect(result.styleId).toBe('apa');
    expect(result.markers[0]).toMatch(/Smith/);
  });

  it('a bundled numeric style still yields a bibliography', async () => {
    const ctx = project.ctx;
    seedSource(project.root);
    setBibliographyStyleId(project.root, 'ieee');
    const result = await renderInlineCitations(ctx, CITE);
    expect(result.styleId).toBe('ieee');
    expect(result.bibliography).not.toBeNull();
  });
});
