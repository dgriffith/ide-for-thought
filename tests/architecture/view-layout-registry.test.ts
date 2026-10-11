/**
 * @vitest-environment happy-dom
 *
 * (happy-dom because the embed parser's module also holds the Svelte mount code.)
 *
 * View layouts have ONE registry (#2623, epic #2622):
 * `src/shared/objects/view-layouts.ts`. A layout used to be named in seven
 * places that had to agree by hand, and adding one meant finding them all.
 *
 * Two checks:
 *
 * 1. **No other file lists layout ids.** A line naming three or more distinct
 *    layout ids — a union type, an array or set of them, a record keyed by
 *    them — is a copy of the registry. Derive it instead: the `ViewLayout`
 *    type, `VIEW_LAYOUTS`, `layoutsFor`, `isViewLayout`, `layoutDef`.
 * 1b. **No file dispatches on a layout id.** `shown === 'kanban'`,
 *    `spec.layout === 'map'`: what a layout does belongs to its registry
 *    entries — `layoutDef(id)` for what it is (`dated`, `grouped`), and
 *    `LAYOUT_RENDERERS[id]` (`type-view/layout-renderers.ts`) for how it's
 *    drawn. The id-keyed `Record` there is the one place allowed to name them.
 * 2. **Every view-spec field is classified** as common to all layouts or owned
 *    by a layout (`specFields`), and every owned field is a real spec field —
 *    so a new field can't arrive without saying which layout it belongs to.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMMON_SPEC_FIELDS, VIEW_LAYOUTS } from '../../src/shared/objects/view-layouts';
import { parseObjectViewSpec } from '../../src/renderer/lib/markdown/object-view-renderer';

const ROOT = path.resolve(__dirname, '../..');
const REGISTRY = 'src/shared/objects/view-layouts.ts';
const RENDERERS = 'src/renderer/lib/components/type-view/layout-renderers.ts';
const IDS: readonly string[] = VIEW_LAYOUTS.map((l) => l.id);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|svelte)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The layout ids a line lists, as quoted literals or as object keys. */
function layoutIdsListed(line: string): Set<string> {
  const alt = IDS.join('|');
  const found = new Set<string>();
  for (const m of line.matchAll(new RegExp(`['"](${alt})['"]`, 'g'))) found.add(m[1]!);
  const keys = new Set<string>();
  for (const m of line.matchAll(new RegExp(`\\b(${alt})\\s*:\\s*['"{\\[]`, 'g'))) keys.add(m[1]!);
  return found.size >= keys.size ? found : keys;
}

/** A comparison of a layout-valued expression (anything named `…layout`, or
 *  TypeView's `shown`) against a layout id — dispatch on the id. */
function dispatchesOnLayoutId(line: string): string | null {
  const alt = IDS.join('|');
  const m = new RegExp(`(\\b\\w*[lL]ayout\\b|\\bshown\\b)\\s*[!=]==\\s*['"](${alt})['"]|['"](${alt})['"]\\s*[!=]==\\s*(\\b\\w*[lL]ayout\\b|\\bshown\\b)`).exec(line);
  return m ? m[0] : null;
}

describe('view layout registry (#2623)', () => {
  it('the detector sees each shape of copy, and not a single comparison', () => {
    expect(layoutIdsListed(`type Layout = 'list' | 'table' | 'gallery' | 'map';`).size).toBe(4);
    expect(layoutIdsListed(`new Set(['list', 'table', 'kanban'])`).size).toBe(3);
    expect(layoutIdsListed(`{ list: 'list', table: 'table', kanban: 'board' }`).size).toBeGreaterThanOrEqual(3);
    expect(layoutIdsListed(`layout === 'table' ? sorted : layout === 'kanban' ? a : b`).size).toBe(2);
  });

  it('the dispatch detector sees a layout-id comparison, and not other strings', () => {
    expect(dispatchesOnLayoutId(`{#if shown === 'kanban'}`)).toBeTruthy();
    expect(dispatchesOnLayoutId(`spec.layout === 'map' ? a : b`)).toBeTruthy();
    expect(dispatchesOnLayoutId(`if ('timeline' !== layout) return;`)).toBeTruthy();
    expect(dispatchesOnLayoutId(`r.surface === 'calendar'`)).toBeNull();
    expect(dispatchesOnLayoutId(`role === 'table'`)).toBeNull();
  });

  it('no file outside the registries dispatches on a layout id', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (rel === REGISTRY || rel === RENDERERS) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const hit = dispatchesOnLayoutId(line);
        if (hit) offenders.push(`${rel}:${i + 1} — ${hit}`);
      });
    }
    expect(offenders, `Dispatch on a layout id — put it on the layout's registry entry (${REGISTRY} or ${RENDERERS}):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no file outside the registry lists layout ids', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (rel === REGISTRY || rel === RENDERERS) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const ids = layoutIdsListed(line);
        if (ids.size >= 3) offenders.push(`${rel}:${i + 1} — ${[...ids].join(', ')}`);
      });
    }
    expect(offenders, `These lines list view-layout ids — derive them from ${REGISTRY} instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every view-spec field is common or owned by a layout, and every owned field exists', () => {
    const specFields = Object.keys(parseObjectViewSpec('{"typeId":"t","layout":"table"}'));
    const owned = new Set(VIEW_LAYOUTS.flatMap((l) => l.specFields as readonly string[]));
    const unclassified = specFields.filter((f) => !COMMON_SPEC_FIELDS.includes(f) && !owned.has(f));
    expect(unclassified, 'classify these in view-layouts.ts (COMMON_SPEC_FIELDS or a layout\'s specFields)').toEqual([]);
    expect([...owned, ...COMMON_SPEC_FIELDS].filter((f) => !specFields.includes(f))).toEqual([]);
    expect(COMMON_SPEC_FIELDS.filter((f) => owned.has(f)), 'a field is common OR owned, not both').toEqual([]);
  });

  it('ids are unique, and every layout has a label and a note name', () => {
    expect(new Set(IDS).size).toBe(IDS.length);
    for (const l of VIEW_LAYOUTS) {
      expect(l.label, l.id).toBeTruthy();
      expect(l.noteName, l.id).toBeTruthy();
    }
  });
});
