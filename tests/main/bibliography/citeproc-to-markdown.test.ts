import { describe, it, expect } from 'vitest';
import { citeprocEntryToMarkdown } from '../../../src/main/bibliography/citeproc-to-markdown';

describe('citeprocEntryToMarkdown (#113)', () => {
  it('strips the csl-entry div wrapper', () => {
    const html = '<div class="csl-entry">Smith, J. (2020). Title.</div>';
    expect(citeprocEntryToMarkdown(html)).toBe('Smith, J. (2020). Title.');
  });

  it('converts <i> to markdown italics', () => {
    const html = '<div class="csl-entry">Smith, J. (2020). <i>Big Book</i>. Press.</div>';
    expect(citeprocEntryToMarkdown(html)).toBe('Smith, J. (2020). *Big Book*. Press.');
  });

  it('converts <b> to markdown bold', () => {
    const html = '<div class="csl-entry"><b>Smith</b> 2020.</div>';
    expect(citeprocEntryToMarkdown(html)).toBe('**Smith** 2020.');
  });

  it('drops unknown tags but keeps inner text', () => {
    const html = '<div class="csl-entry">Smith, J. <span style="font-variant: small-caps">acme</span>.</div>';
    expect(citeprocEntryToMarkdown(html)).toBe('Smith, J. acme.');
  });

  it('decodes named and numeric HTML entities', () => {
    const html = '<div class="csl-entry">Smith &amp; Jones (2020). It&#x27;s &lt;done&gt;.</div>';
    expect(citeprocEntryToMarkdown(html)).toBe("Smith & Jones (2020). It's <done>.");
  });

  it('collapses internal whitespace to single spaces', () => {
    const html = '<div class="csl-entry">Smith,   J.\n   (2020).\n  Title.</div>';
    expect(citeprocEntryToMarkdown(html)).toBe('Smith, J. (2020). Title.');
  });

  it('passes through entries that have no wrapper div', () => {
    const html = 'Smith, J. (2020). <i>Title</i>.';
    expect(citeprocEntryToMarkdown(html)).toBe('Smith, J. (2020). *Title*.');
  });
});
