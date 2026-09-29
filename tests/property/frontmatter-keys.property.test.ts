/**
 * Property tests for frontmatter keys named after `Object.prototype` members
 * (#2461 follow-up): the graph parser (`parseMarkdown`) and the property
 * writers (`setPropertyInContent`, `patchFrontmatterProperties`).
 *
 * For any set of keys drawn from every `Object.prototype` name (`__proto__`
 * included) plus ordinary ones:
 *   - parse keeps exactly those keys, as own properties, with their values;
 *   - no name that is absent reads as anything but `undefined`;
 *   - parse → edit another key → parse is stable for every other key.
 *
 * Counterexample convention: see `untrusted-content.property.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import YAML from 'yaml';
import { parseMarkdown } from '../../src/main/graph/parser';
import { ownRecord } from '../../src/shared/own-record';
import { setPropertyInContent } from '../../src/shared/refactor/frontmatter-properties';
import { patchFrontmatterProperties } from '../../src/shared/refactor/frontmatter-patch';
import { propertyParams } from '../helpers/property';

const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype);

// `title`/`tags`/`aliases` are fine keys too, but keep values plain so the
// comparison is about keys, not about YAML's scalar typing.
const key = fc.oneof(
  fc.constantFrom(...PROTO_NAMES),
  fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/),
);
const value = fc.stringMatching(/^[a-z][a-z ]{0,10}[a-z]$/);

const frontmatter = fc.uniqueArray(fc.tuple(key, value), { selector: ([k]) => k, minLength: 1, maxLength: 12 });

function note(entries: ReadonlyArray<readonly [string, string]>): string {
  return `---\n${YAML.stringify(ownRecord(entries)).trimEnd()}\n---\n# Body\n`;
}

/** The note's frontmatter as own [key, value] pairs, via a fresh YAML parse. */
function ownEntriesOf(content: string): Array<[string, unknown]> {
  const m = content.match(/^---\n([\s\S]*?)\n---/)!;
  return Object.entries(YAML.parse(m[1]!) as Record<string, unknown>);
}

describe('frontmatter keys named after Object.prototype members', () => {
  it('parseMarkdown keeps exactly the written keys and reads absent names as undefined', () => {
    fc.assert(
      fc.property(frontmatter, (entries) => {
        const fm = parseMarkdown(note(entries)).frontmatter;
        expect(Object.entries(fm)).toEqual(entries);
        expect(Object.getPrototypeOf(fm)).toBeNull();
        const present = new Set(entries.map(([k]) => k));
        for (const name of PROTO_NAMES) {
          if (!present.has(name)) expect(fm[name], name).toBeUndefined();
        }
      }),
      propertyParams(200),
    );
  });

  it('adding one property keeps every other key (Add Property and set_properties)', () => {
    fc.assert(
      fc.property(frontmatter, key, value, (entries, newKey, newValue) => {
        const expected = [...entries.filter(([k]) => k !== newKey), [newKey, newValue]];
        const byKey = (a: [string, unknown], b: [string, unknown]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
        const src = note(entries);

        const viaAdd = setPropertyInContent(src, newKey, newValue).content;
        expect(ownEntriesOf(viaAdd).sort(byKey)).toEqual([...expected].sort(byKey));

        const viaPatch = patchFrontmatterProperties(src, ownRecord([[newKey, newValue]])).content;
        expect(ownEntriesOf(viaPatch).sort(byKey)).toEqual([...expected].sort(byKey));

        // And the graph parser agrees with the writer.
        expect(Object.entries(parseMarkdown(viaAdd).frontmatter).sort(byKey)).toEqual([...expected].sort(byKey));
      }),
      propertyParams(200),
    );
  });
});
