/**
 * Unit cover for the docs-site model (#1842) — the parts `docs-generated.test.ts`
 * can only assert indirectly, against the real 118 pages: what the generator
 * does with a MALFORMED input, and the one substitution bug that got past a
 * first byte-diff.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain JS build-time module, no .d.ts
import * as modelImpl from '../../scripts/lib/docs-model.mjs';

interface NavItem { href: string; label: string; title?: string; crumb?: string; children?: NavItem[] }
interface Fragment { title: string; description: string; body: string }
interface Nav { sections: { label: string; items: NavItem[] }[]; order: string[]; byHref: Map<string, NavItem>; parentOf: Map<string, NavItem> }

const model = modelImpl as {
  parseFragment: (raw: string, name: string) => Fragment;
  renderPage: (layout: string, nav: Nav, href: string, fragment: Fragment) => string;
  isExternal: (href: string) => boolean;
};

/** A nav shaped like `loadNav`'s return, without touching the filesystem. */
function navOf(sections: { label: string; items: NavItem[] }[]): Nav {
  const order: string[] = [];
  const byHref = new Map<string, NavItem>();
  const parentOf = new Map<string, NavItem>();
  for (const section of sections) {
    for (const item of section.items) {
      order.push(item.href);
      byHref.set(item.href, item);
      for (const child of item.children ?? []) {
        order.push(child.href);
        byHref.set(child.href, child);
        parentOf.set(child.href, item);
      }
    }
  }
  return { sections, order, byHref, parentOf };
}

const NAV = navOf([
  {
    label: 'Section',
    items: [
      { href: 'index.html', label: 'Overview' },
      {
        href: 'data.html',
        label: 'Data',
        title: 'Working with data',
        children: [{ href: 'maths.html', label: 'The long name for maths', crumb: 'Maths' }],
      },
      { href: '../getting-started.html', label: 'Getting started' },
    ],
  },
]);

const LAYOUT = '<title>{{title}}</title>\n<meta content="{{description}}" />\n<aside>\n{{sidebar}}\n</aside>\n<main>\n{{content}}\n</main>\n';

describe('parseFragment', () => {
  const ok = '---\ntitle: T\ndescription: D\n---\n\n    <h1>Body</h1>\n';

  it('splits front-matter from body and trims the body\'s blank edges', () => {
    expect(model.parseFragment(ok, 'x.html')).toEqual({ title: 'T', description: 'D', body: '    <h1>Body</h1>' });
  });

  it.each([
    ['<h1>no fence</h1>', 'missing opening'],
    ['---\ntitle: T\ndescription: D\n\n    <h1>x</h1>\n', 'missing closing'],
    ['---\ntitle: T\n---\n\n    <h1>x</h1>\n', 'missing "description"'],
    ['---\ntitle T\ndescription: D\n---\n\n    <h1>x</h1>\n', 'not "key: value"'],
    ['---\ntitle: T\ndescription: D\n---\n\n', 'empty body'],
  ])('rejects %j', (raw, message) => {
    expect(() => model.parseFragment(raw, 'x.html')).toThrow(message);
  });
});

describe('renderPage', () => {
  const fragment = { title: 'T', description: 'D', body: '    <h1>Maths</h1>' };

  it('substitutes `$$…$$` display math verbatim', () => {
    // A *string* replacement would read `$$` as an escaped `$` and halve it —
    // which is exactly what notes-math.html's `$$\int…$$` blocks hit.
    const math = { ...fragment, body: '    <p>$$\\int_0^\\infty$$ and $& and $1</p>' };
    expect(model.renderPage(LAYOUT, NAV, 'maths.html', math)).toContain('<p>$$\\int_0^\\infty$$ and $& and $1</p>');
  });

  it('expands only the active page\'s own family, and marks it active', () => {
    const html = model.renderPage(LAYOUT, NAV, 'maths.html', fragment);
    expect(html).toContain('<a href="data.html">Data</a>');
    expect(html).toContain('<a href="maths.html" class="sub active">The long name for maths</a>');

    // …and not when a sibling family is the active one.
    const other = model.renderPage(LAYOUT, NAV, 'index.html', fragment);
    expect(other).toContain('<a href="index.html" class="active">Overview</a>');
    expect(other).not.toContain('maths.html');
  });

  it('uses `crumb` in the trail and `title` in the pager', () => {
    const html = model.renderPage(LAYOUT, NAV, 'maths.html', fragment);
    // Crumb: shortest form for this page, its parent's `title` for the family.
    expect(html).toContain('<a href="data.html">Working with data</a><span class="sep">/</span>Maths');
    // Pager: the page's own (longer) name, from the neighbour's entry.
    expect(html).toContain('<span class="ttl">← Working with data</span>');
    expect(html).toContain('<span class="ttl">Getting started →</span>');
  });

  it('gives the docs root no crumbs and no previous link', () => {
    const html = model.renderPage(LAYOUT, NAV, 'index.html', fragment);
    expect(html).not.toContain('class="crumbs"');
    expect(html).toContain('<div class="pager">\n      <span></span>');
  });

  it('rejects a layout with a placeholder it cannot fill', () => {
    expect(() => model.renderPage(`${LAYOUT}{{author}}`, NAV, 'index.html', fragment))
      .toThrow('unknown placeholder {{author}}');
  });
});

describe('isExternal', () => {
  it.each([['../getting-started.html', true], ['https://example.com', true], ['notes.html', false]])(
    '%s → %s',
    (href, expected) => { expect(model.isExternal(href)).toBe(expected); },
  );
});
