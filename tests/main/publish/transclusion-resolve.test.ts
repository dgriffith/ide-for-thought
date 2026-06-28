import { describe, it, expect } from 'vitest';
import { resolveTransclusions } from '../../../src/main/publish/transclusion-resolve';
import type { ExportPlanFile } from '../../../src/main/publish/types';

function note(relativePath: string, content: string): ExportPlanFile {
  return { kind: 'note', relativePath, title: relativePath.replace(/\.md$/, ''), content };
}

describe('resolveTransclusions', () => {
  it('inlines a whole-note embed', () => {
    const inputs = [note('host.md', 'Before\n\n![[child]]\n\nAfter'), note('child.md', 'Child body.')];
    const out = resolveTransclusions(inputs[0].content, 'host.md', inputs);
    expect(out).toContain('Before');
    expect(out).toContain('Child body.');
    expect(out).toContain('After');
    expect(out).not.toContain('![[');
  });

  it('inlines a heading section', () => {
    const child = note('child.md', '## Intro\nintro text\n\n## Other\nother');
    const inputs = [note('host.md', '![[child#Intro]]'), child];
    const out = resolveTransclusions(inputs[0].content, 'host.md', inputs);
    expect(out).toContain('intro text');
    expect(out).not.toContain('other');
  });

  it('inlines a block ref', () => {
    const child = note('child.md', 'A claim worth quoting. ^k1\n\nsomething else');
    const inputs = [note('host.md', '![[child#^k1]]'), child];
    const out = resolveTransclusions(inputs[0].content, 'host.md', inputs);
    expect(out).toContain('A claim worth quoting.');
    expect(out).not.toContain('^k1');
    expect(out).not.toContain('something else');
  });

  it('resolves nested embeds recursively', () => {
    const inputs = [
      note('a.md', '![[b]]'),
      note('b.md', 'B says\n\n![[c]]'),
      note('c.md', 'C leaf'),
    ];
    const out = resolveTransclusions(inputs[0].content, 'a.md', inputs);
    expect(out).toContain('C leaf');
  });

  it('breaks a cycle with a visible notice', () => {
    const inputs = [note('a.md', 'A\n\n![[b]]'), note('b.md', 'B\n\n![[a]]')];
    const out = resolveTransclusions(inputs[0].content, 'a.md', inputs);
    expect(out).toContain('transclusion loop');
    // It still inlined one level before detecting the loop back to the host.
    expect(out).toContain('B');
  });

  it('degrades a missing note to a notice', () => {
    const inputs = [note('host.md', '![[ghost]]')];
    const out = resolveTransclusions(inputs[0].content, 'host.md', inputs);
    expect(out).toContain('not found');
  });

  it('degrades a target outside the export set', () => {
    // resolvable by name would need it in inputs; absent entirely → not found.
    const inputs = [note('host.md', '![[elsewhere]]')];
    const out = resolveTransclusions(inputs[0].content, 'host.md', inputs);
    expect(out).toMatch(/not found|not included/);
  });

  it('leaves a mid-sentence embed untouched (block form only)', () => {
    const inputs = [note('host.md', 'see ![[child]] inline'), note('child.md', 'X')];
    const out = resolveTransclusions(inputs[0].content, 'host.md', inputs);
    expect(out).toContain('![[child]]');
  });
});
