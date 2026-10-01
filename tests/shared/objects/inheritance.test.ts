/**
 * Subclass property inheritance (#1587): effective properties = ancestors' props
 * (root-first) + own, child overriding by name; cycle-safe.
 */
import { describe, it, expect } from 'vitest';
import { effectivePropertyDefs, effectiveTemplate, toTypeInfoWithInheritance, type TypeLike } from '../../../src/shared/objects/inheritance';
import type { PropertyDef } from '../../../src/shared/objects/type-def';

const p = (name: string, type: PropertyDef['type'] = 'text'): PropertyDef => ({ name, type });
function map(...types: TypeLike[]): Map<string, TypeLike> {
  return new Map(types.map((t) => [t.id, t]));
}

describe('effectivePropertyDefs (#1587)', () => {
  it('returns a parentless type\'s own properties', () => {
    const m = map({ id: 'book', properties: [p('author'), p('rating')] });
    expect(effectivePropertyDefs('book', m).map((x) => x.name)).toEqual(['author', 'rating']);
  });

  it('inherits the parent\'s properties, ancestor-first, child appends its own', () => {
    const m = map(
      { id: 'reference', properties: [p('citation'), p('year')] },
      { id: 'monograph', parent: 'reference', properties: [p('isbn')] },
    );
    expect(effectivePropertyDefs('monograph', m).map((x) => x.name)).toEqual(['citation', 'year', 'isbn']);
  });

  it('lets the child override an inherited property in place (by name)', () => {
    const m = map(
      { id: 'reference', properties: [p('year', 'text')] },
      { id: 'monograph', parent: 'reference', properties: [p('year', 'number'), p('isbn')] },
    );
    const eff = effectivePropertyDefs('monograph', m);
    expect(eff.map((x) => x.name)).toEqual(['year', 'isbn']); // year kept its position
    expect(eff.find((x) => x.name === 'year')!.type).toBe('number'); // child's type wins
  });

  it('walks a multi-level chain root-first', () => {
    const m = map(
      { id: 'a', properties: [p('a1')] },
      { id: 'b', parent: 'a', properties: [p('b1')] },
      { id: 'c', parent: 'b', properties: [p('c1')] },
    );
    expect(effectivePropertyDefs('c', m).map((x) => x.name)).toEqual(['a1', 'b1', 'c1']);
  });

  it('is cycle-safe', () => {
    const m = map(
      { id: 'x', parent: 'y', properties: [p('x1')] },
      { id: 'y', parent: 'x', properties: [p('y1')] },
    );
    // Terminates; each type's props appear once.
    expect(effectivePropertyDefs('x', m).map((x) => x.name).sort()).toEqual(['x1', 'y1']);
  });

  it('stops at an unknown parent (dangling ref)', () => {
    const m = map({ id: 'monograph', parent: 'ghost', properties: [p('isbn')] });
    expect(effectivePropertyDefs('monograph', m).map((x) => x.name)).toEqual(['isbn']);
  });
});

describe('effectiveTemplate (#2494)', () => {
  const t = (id: string, template?: string, parent?: string) => ({ id, parent, template, properties: [] as PropertyDef[] });

  it('uses the type\'s own body', () => {
    expect(effectiveTemplate('shop', new Map([['shop', t('shop', '## Shop')]]))).toEqual({ template: '## Shop', fromTypeId: 'shop' });
  });

  it('falls back to the nearest ancestor with a body, skipping blank ones', () => {
    const m = new Map([t('place', '## Visit\n{{address}}'), t('venue', '  ', 'place'), t('shop', undefined, 'venue')].map((x) => [x.id, x]));
    expect(effectiveTemplate('shop', m)).toEqual({ template: '## Visit\n{{address}}', fromTypeId: 'place' });
  });

  it('is undefined when nothing in the chain has a body, and terminates on a cycle', () => {
    expect(effectiveTemplate('a', new Map([['a', t('a')]]))).toBeUndefined();
    const cyc = new Map([t('a', undefined, 'b'), t('b', undefined, 'a')].map((x) => [x.id, x]));
    expect(effectiveTemplate('a', cyc)).toBeUndefined();
  });
});

describe('toTypeInfoWithInheritance (#2490, #2494)', () => {
  it('adds the effective body and property names, keeping `template` the type\'s own', () => {
    const place = { id: 'place', label: 'Place', classLocalName: 'Place', source: 'stock' as const, filePath: '', properties: [p('address'), p('city')], template: '{{address}}' };
    const shop = { id: 'shop', label: 'Shop', classLocalName: 'Shop', source: 'project' as const, filePath: '', parent: 'place', properties: [p('category')] };
    const info = toTypeInfoWithInheritance(shop, new Map([['place', place], ['shop', shop]]));
    expect(info.template).toBeUndefined();
    expect(info.effectiveTemplate).toBe('{{address}}');
    expect(info.templateFrom).toBe('place');
    expect(info.effectivePropertyNames).toEqual(['address', 'city', 'category']);
  });
});
