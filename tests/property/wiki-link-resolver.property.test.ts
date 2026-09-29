/**
 * Property tests for the wiki-link resolver's alias lookup
 * (`src/shared/wiki-link-resolver.ts`, #2456 follow-up).
 *
 * The alias record is a plain object on the renderer side (it crosses IPC as
 * one), so a bare `aliases[key]` read answered `[[constructor]]` with
 * `Object.prototype.constructor`. For every name `Object.prototype` carries, in
 * any casing and with or without a note extension, a thoughtbase with no note
 * and no alias of that name resolves it to nothing — through the loop resolver
 * and the indexed one, for every shape the alias record arrives in.
 *
 * Counterexample convention: see `untrusted-content.property.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ownRecord } from '../../src/shared/own-record';
import {
  buildWikiLinkIndex, resolveWikiLinkTarget, resolveWikiLinkTargetWithIndex,
} from '../../src/shared/wiki-link-resolver';
import { propertyParams } from '../helpers/property';

const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype);

const name = fc.tuple(
  fc.constantFrom(...PROTO_NAMES),
  fc.constantFrom('as-is', 'lower', 'upper'),
  fc.constantFrom('', '.md'),
).map(([n, casing, ext]) => (casing === 'lower' ? n.toLowerCase() : casing === 'upper' ? n.toUpperCase() : n) + ext);

/** Notes and aliases whose names can't collide with a prototype member. */
const FILES = [
  { relativePath: 'notes/raft.md', isDirectory: false },
  { relativePath: 'journal/2026-09-29.md', isDirectory: false },
  { relativePath: 'data/budget.csv', isDirectory: false },
];
const ENTRIES: [string, string][] = [['intro', 'notes/raft.md'], ['consensus', 'notes/raft.md']];

const aliasShape = fc.constantFrom<[string, () => Record<string, string>]>(
  ['none', () => ({})],
  ['plain object', () => Object.fromEntries(ENTRIES)],
  ['ownRecord', () => ownRecord(ENTRIES)],
  ['structured clone', () => structuredClone(ownRecord(ENTRIES))],
  ['JSON', () => JSON.parse(JSON.stringify(ownRecord(ENTRIES))) as Record<string, string>],
);

describe('resolver alias lookup ignores Object.prototype (#2456 follow-up)', () => {
  it('resolves a prototype member name to nothing when no note or alias has it', () => {
    fc.assert(
      fc.property(name, aliasShape, (target, [, make]) => {
        const aliases = make();
        const index = buildWikiLinkIndex(FILES, aliases);
        expect(resolveWikiLinkTarget(target, FILES, aliases)).toBeNull();
        expect(resolveWikiLinkTargetWithIndex(target, index)).toBeNull();
        expect(resolveWikiLinkTargetWithIndex(target, index, { pathSlugFallback: false })).toBeNull();
      }),
      propertyParams(200),
    );
  });

  it('resolves a prototype member name used as an alias to that alias', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PROTO_NAMES), (alias) => {
        const aliases = structuredClone(ownRecord([...ENTRIES, [alias.toLowerCase(), 'journal/2026-09-29.md']]));
        const index = buildWikiLinkIndex(FILES, aliases);
        expect(resolveWikiLinkTarget(alias, FILES, aliases)).toBe('journal/2026-09-29.md');
        expect(resolveWikiLinkTargetWithIndex(alias, index)).toBe('journal/2026-09-29.md');
        expect(resolveWikiLinkTargetWithIndex('intro', index)).toBe('notes/raft.md');
      }),
      propertyParams(50),
    );
  });
});
