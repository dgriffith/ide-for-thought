/**
 * Subclass property inheritance (#1587): effective properties = ancestors' props
 * (root-first) + own, child overriding by name; cycle-safe.
 */
import { describe, it, expect } from 'vitest';
import { effectivePropertyDefs, type TypeLike } from '../../../src/shared/objects/inheritance';
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
