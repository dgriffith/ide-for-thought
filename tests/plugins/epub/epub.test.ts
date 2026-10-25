/**
 * The EPUB plugin (#2648): Minerva's rendered HTML as XHTML, one chapter per
 * note with a table of contents and package file, and the zip laid out the
 * way a reader expects — `mimetype` first and stored.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { bookFilename, buildEpub, toXhtml } from '../../../plugins/epub/src/epub';
import { packEpub } from '../../../plugins/epub/src/pack';
import type { PluginExportPlan } from '../../../src/shared/plugins/format';

const PLAN: PluginExportPlan = {
  exporter: 'epub',
  scope: 'folder',
  title: 'Field Notes',
  notes: [
    { path: 'book/one.md', title: 'One', frontmatter: { author: 'Ada', lang: 'en-GB' }, html: '<h1>One</h1>\n<p>See <a href="two.html#later">two</a>.</p>' },
    { path: 'book/two.md', title: 'Two & more', frontmatter: {}, html: '<p id="later">Later<br>on&nbsp;&hellip;</p>' },
  ],
};

describe('toXhtml (#2648)', () => {
  it('closes void elements, quotes attributes and gives a bare one a value', () => {
    expect(toXhtml('<p>a<br>b<hr></p><input type=checkbox checked disabled>'))
      .toBe('<p>a<br/>b<hr/></p><input type="checkbox" checked="checked" disabled="disabled"/>');
  });
  it('writes named entities as numbers, keeps XML\'s own, and escapes a stray ampersand', () => {
    expect(toXhtml('<p>a&nbsp;b &amp; c &copy; R&D &unknown;</p>')).toBe('<p>a&#160;b &amp; c &#169; R&amp;D &amp;unknown;</p>');
  });
  it('re-escapes attribute values once, and drops comments', () => {
    expect(toXhtml('<a title="a &amp; b &quot;c&quot;" href=\'x?y=1&z=2\'>t</a><!-- -- -->'))
      .toBe('<a title="a &amp; b &quot;c&quot;" href="x?y=1&amp;z=2">t</a>');
  });
});

describe('buildEpub (#2648)', () => {
  const files = buildEpub(PLAN, new Date('2026-10-25T12:00:00.123Z'));
  const file = (p: string) => files.find((f) => f.path === p)!.text;

  it('lays the book out with mimetype first', () => {
    expect(files.map((f) => f.path)).toEqual([
      'mimetype', 'META-INF/container.xml', 'OEBPS/style.css',
      'OEBPS/chapter-001.xhtml', 'OEBPS/chapter-002.xhtml', 'OEBPS/nav.xhtml', 'OEBPS/content.opf',
    ]);
    expect(file('mimetype')).toBe('application/epub+zip');
  });

  it('points a link to another exported note at its chapter, and titles a chapter with no h1', () => {
    expect(file('OEBPS/chapter-001.xhtml')).toContain('<a href="chapter-002.xhtml#later">two</a>');
    expect(file('OEBPS/chapter-001.xhtml')).toContain('lang="en-GB" xml:lang="en-GB"');
    expect(file('OEBPS/chapter-002.xhtml')).toContain('<h1>Two &amp; more</h1>\n<p id="later">Later<br/>on&#160;&#8230;</p>');
  });

  it('turns an image the book can\'t carry into its alt text, and keeps an embedded one', () => {
    const [, , , chapter] = buildEpub({ ...PLAN, notes: [{ ...PLAN.notes[0]!, html: '<p><img src="assets/x.png" alt="A map"><img src="data:image/png;base64,AA==" alt="dot"></p>' }] });
    expect(chapter!.text).toContain('<p>A map<img src="data:image/png;base64,AA==" alt="dot"/></p>');
  });

  it('lists every chapter in the contents, manifest and spine, with the metadata', () => {
    expect(file('OEBPS/nav.xhtml')).toContain('<li><a href="chapter-002.xhtml">Two &amp; more</a></li>');
    const opf = file('OEBPS/content.opf');
    expect(opf).toContain('<dc:title>Field Notes</dc:title>');
    expect(opf).toContain('<dc:creator>Ada</dc:creator>');
    expect(opf).toContain('<meta property="dcterms:modified">2026-10-25T12:00:00Z</meta>');
    expect(opf).toContain('<itemref idref="c2"/>');
    expect(opf).toMatch(/<dc:identifier id="book-id">urn:minerva:epub:[0-9a-f]{8}<\/dc:identifier>/);
    expect(buildEpub(PLAN).find((f) => f.path === 'OEBPS/content.opf')!.text).toContain(opf.match(/urn:minerva:epub:[0-9a-f]+/)![0]);
  });

  it('names the file after the book, safely', () => {
    expect(bookFilename('Field Notes')).toBe('Field Notes.epub');
    expect(bookFilename('../a/b: c')).toBe('a b c.epub');
    expect(bookFilename('...')).toBe('Export.epub');
  });
});

describe('packEpub (#2648)', () => {
  it('zips the book with mimetype first and stored, as one file to write', async () => {
    const result = await packEpub(PLAN);
    expect(result.summary).toBe('Exported "Field Notes" as EPUB, 2 chapters.');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.path).toBe('Field Notes.epub');
    const bytes = Buffer.from(result.files[0]!.base64!, 'base64');
    // The first local header: "PK\3\4", method 0 (stored) at byte 8, then "mimetype" at byte 30.
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(bytes.readUInt16LE(8)).toBe(0);
    expect(bytes.subarray(30, 38).toString()).toBe('mimetype');
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('OEBPS/chapter-001.xhtml')!.async('string')).toContain('<h1>One</h1>');
  });
});
