/**
 * Frontmatter edits round-trip keys named after `Object.prototype` members
 * (#2461 follow-up). Every writer here parses YAML into an object, reads or
 * writes it by a user-text key, and serialises it back — so each one either
 * lost a `__proto__:` key, answered an absent `constructor` with a function, or
 * (the formatter) rewrote a `constructor:` key into a function.
 */
import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import { getOwn, ownRecord } from '../../src/shared/own-record';
import {
  setPropertyInContent,
  removePropertyFromContent,
  extractPropertyKeysFromContent,
} from '../../src/shared/refactor/frontmatter-properties';
import { patchFrontmatterProperties, readFrontmatterProperties } from '../../src/shared/refactor/frontmatter-patch';
import { getFrontmatterValues, setFrontmatterProperty } from '../../src/shared/frontmatter-edit';
import { applyFrontmatterMutation, parseFrontmatter } from '../../src/shared/refactor/frontmatter-rows';
import '../../src/shared/formatter/rules/minerva/canonicalize-frontmatter-keys';
import { formatContent } from '../../src/shared/formatter/engine';

const NOTE = '---\n__proto__: kept\nconstructor: foo\ntoString: bar\n---\nBody\n';

/** Parse a note's frontmatter back out, as an own-keys map. */
function fmOf(content: string): Record<string, unknown> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const raw = YAML.parse(m[1]!) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw));
}

describe('ownRecord / getOwn', () => {
  it('stores __proto__ as an own key and answers only own keys', () => {
    const rec = ownRecord<unknown>([['__proto__', { x: 1 }], ['a', 1]]);
    expect(Object.getPrototypeOf(rec)).toBeNull();
    expect(Object.keys(rec)).toEqual(['__proto__', 'a']);
    expect(getOwn(rec, '__proto__')).toEqual({ x: 1 });
    expect(getOwn(rec, 'constructor')).toBeUndefined();
    const plain: Record<string, unknown> = { a: 1 };
    expect(getOwn(plain, 'constructor')).toBeUndefined();
    expect(getOwn(plain, 'hasOwnProperty')).toBeUndefined();
    expect(getOwn(structuredClone(rec), '__proto__')).toEqual({ x: 1 });
  });
});

describe('setPropertyInContent (Add Property)', () => {
  it('editing another key keeps __proto__, constructor and toString', () => {
    const { content, changed } = setPropertyInContent(NOTE, 'status', 'draft');
    expect(changed).toBe(true);
    expect(fmOf(content)).toEqual({ ['__proto__']: 'kept', constructor: 'foo', toString: 'bar', status: 'draft' });
    expect(content.endsWith('Body\n')).toBe(true);
  });

  it('adds a __proto__ / constructor key that was absent', () => {
    const a = setPropertyInContent('---\ntitle: T\n---\n', '__proto__', 'p');
    expect(a.changed).toBe(true);
    expect(fmOf(a.content)).toEqual({ title: 'T', ['__proto__']: 'p' });
    const b = setPropertyInContent('---\ntitle: T\n---\n', 'constructor', 'c');
    expect(b.changed).toBe(true);
    expect(fmOf(b.content)).toEqual({ title: 'T', constructor: 'c' });
  });

  it('is a no-op when the key already holds the value', () => {
    expect(setPropertyInContent(NOTE, 'constructor', 'foo').changed).toBe(false);
    expect(setPropertyInContent(NOTE, '__proto__', 'kept').changed).toBe(false);
  });
});

describe('removePropertyFromContent / extractPropertyKeysFromContent', () => {
  it('lists the Object.prototype-named keys that are really there', () => {
    expect(extractPropertyKeysFromContent(NOTE)).toEqual(['__proto__', 'constructor', 'toString']);
  });

  it('does not report an absent constructor/hasOwnProperty as removed', () => {
    const src = '---\ntitle: T\n---\n';
    for (const key of ['constructor', 'hasOwnProperty', '__proto__', 'toString']) {
      expect(removePropertyFromContent(src, key)).toEqual({ content: src, removed: false });
    }
  });

  it('removes one of them and keeps the others', () => {
    const { content, removed } = removePropertyFromContent(NOTE, 'constructor');
    expect(removed).toBe(true);
    expect(fmOf(content)).toEqual({ ['__proto__']: 'kept', toString: 'bar' });
  });
});

describe('patchFrontmatterProperties / readFrontmatterProperties (set_properties)', () => {
  it('patching another key keeps the Object.prototype-named ones', () => {
    const { content, changedKeys } = patchFrontmatterProperties(NOTE, { status: 'done' });
    expect(changedKeys).toEqual(['status']);
    expect(fmOf(content)).toEqual({ ['__proto__']: 'kept', constructor: 'foo', toString: 'bar', status: 'done' });
  });

  it('sets and deletes a __proto__ key from a JSON-shaped patch', () => {
    const patch = JSON.parse('{"__proto__": {"x": 1}, "constructor": null}') as Record<string, never>;
    const { content, changedKeys, deletedKeys } = patchFrontmatterProperties(NOTE, patch);
    expect(changedKeys.sort()).toEqual(['__proto__', 'constructor']);
    expect(deletedKeys).toEqual(['constructor']);
    expect(fmOf(content)).toEqual({ ['__proto__']: { x: 1 }, toString: 'bar' });
  });

  it('deleting an absent constructor is not a change', () => {
    const src = '---\ntitle: T\n---\n';
    expect(patchFrontmatterProperties(src, JSON.parse('{"constructor": null}') as Record<string, never>))
      .toEqual({ content: src, changedKeys: [], deletedKeys: [] });
  });

  it('reads back own keys only', () => {
    const fm = readFrontmatterProperties(NOTE);
    expect(Object.keys(fm)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(getOwn(fm, '__proto__')).toBe('kept');
    expect(readFrontmatterProperties('---\ntitle: T\n---\n').constructor).toBeUndefined();
    expect(JSON.parse(JSON.stringify(fm))).toEqual({ ['__proto__']: 'kept', constructor: 'foo', toString: 'bar' });
  });
});

describe('frontmatter-edit (typed-property form)', () => {
  it('getFrontmatterValues keeps __proto__ and reads absent names as undefined', () => {
    const v = getFrontmatterValues(NOTE);
    expect(Object.keys(v)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(getOwn(v, '__proto__')).toBe('kept');
    const plain = getFrontmatterValues('---\ntitle: T\n---\n');
    expect(plain.constructor).toBeUndefined();
    expect(plain.type).toBeUndefined();
  });

  it('setFrontmatterProperty keeps the other keys', () => {
    expect(fmOf(setFrontmatterProperty(NOTE, 'rating', 5)))
      .toEqual({ ['__proto__']: 'kept', constructor: 'foo', toString: 'bar', rating: 5 });
    expect(fmOf(setFrontmatterProperty(NOTE, 'constructor', null)))
      .toEqual({ ['__proto__']: 'kept', toString: 'bar' });
  });
});

describe('frontmatter-rows (Properties panel)', () => {
  it('lists the rows and keeps them through a mutation', () => {
    const parsed = parseFrontmatter(NOTE);
    expect(parsed.ok && parsed.rows.map((r) => r.key)).toEqual(['__proto__', 'constructor', 'toString']);
    const next = applyFrontmatterMutation(NOTE, (doc) => { doc.set('status', 'x'); });
    expect(fmOf(next!)).toEqual({ ['__proto__']: 'kept', constructor: 'foo', toString: 'bar', status: 'x' });
  });
});

describe('canonicalize-frontmatter-keys formatter rule', () => {
  it('leaves Object.prototype-named keys alone', () => {
    const enabled = { enabled: { 'canonicalize-frontmatter-keys': true }, configs: {} };
    expect(formatContent(NOTE, enabled)).toBe(NOTE);
    const src = '---\nhasOwnProperty: a\nvalueOf: b\n---\n';
    expect(formatContent(src, enabled)).toBe(src);
  });
});
