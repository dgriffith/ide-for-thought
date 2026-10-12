/**
 * The inspection catalog (#1792) — the contract between the engine, the
 * settings panel, and the config file.
 *
 * The interesting failure isn't a wrong label; it's DRIFT. A check that exists
 * in the engine but not the catalog can never be switched off; a catalog entry
 * with no engine behind it is a switch that controls nothing. Both look fine in
 * review and only show up when a user flips a toggle and nothing happens — so
 * the catalog is checked against the check registry (#2627) here, and against
 * the engine source as a backstop for what a code check emits.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  INSPECTIONS,
  visibleInspections,
  catalogTypeFor,
  isInspectionEnabled,
  DEFAULT_INSPECTION_SETTINGS,
} from '../../src/shared/inspections';
import { INSPECTION_CHECKS } from '../../src/main/graph/health-checks';

/**
 * Every `type: '…'` the engine actually emits, across every module of it.
 *
 * Reads the whole `graph/` directory rather than naming `health-checks.ts`
 * (#2208). It used to name that one file, which made this a check on a file
 * PATH where it means to be a check on a responsibility — the same shape
 * CLAUDE.md records under #2232. Moving the five source checks into
 * `source-checks.ts` was enough to blind it: it immediately reported those
 * five catalog entries as switches controlling nothing, which was the
 * detector being wrong rather than the catalog. Scanning the directory means
 * the next split costs nothing here.
 *
 * Scoped to `type: '<snake_case>',` in an object literal, which in this tree
 * only ever spells an `Inspection`'s type; an unrelated match would surface as
 * an "uncovered" failure rather than passing silently.
 */
function enginesEmittedTypes(): Set<string> {
  const dir = path.join(__dirname, '..', '..', 'src', 'main', 'graph');
  const found = new Set<string>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const src = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
    for (const m of src.matchAll(/^\s*type: '([a-z_]+)',/gm)) found.add(m[1]!);
  }
  return found;
}

describe('inspection catalog', () => {
  it('covers every check the engine emits', () => {
    const cataloged = new Set(INSPECTIONS.map((i) => i.type));
    const uncovered = [...enginesEmittedTypes()]
      .filter((t) => !cataloged.has(catalogTypeFor(t)));
    expect(uncovered, 'engine emits these with no catalog entry — they can never be switched off').toEqual([]);
  });

  it('has exactly one registered check behind every entry (#2627)', () => {
    // The registry says which check produces each type; a type with none is a
    // switch that controls nothing, and one claimed twice is two checks
    // reporting the same finding.
    const claims = new Map<string, string[]>();
    for (const check of INSPECTION_CHECKS) {
      const id = check.kind === 'sparql' ? check.type : check.id;
      const emits = check.kind === 'sparql' ? [check.type] : check.emits;
      for (const t of emits) claims.set(t, [...(claims.get(t) ?? []), id]);
    }
    const wrong = INSPECTIONS
      .map((i) => i.type)
      .filter((t) => (claims.get(t) ?? []).length !== 1)
      .map((t) => `${t}: ${(claims.get(t) ?? []).join(', ') || 'no check'}`);
    expect(wrong, 'catalog types without exactly one check').toEqual([]);
    expect([...claims.keys()].filter((t) => !INSPECTIONS.some((i) => i.type === t)), 'checks emitting uncatalogued types').toEqual([]);
  });

  it('ports at least one built-in to the declarative SPARQL kind (#2627)', () => {
    expect(INSPECTION_CHECKS.filter((c) => c.kind === 'sparql').map((c) => c.kind === 'sparql' && c.type))
      .toEqual(expect.arrayContaining(['unsupported_claim', 'contradiction']));
  });

  it('withholds the argument-map checks and nothing else', () => {
    // The user's instruction for this release: the argument map isn't
    // user-facing, so it isn't advertised or documented.
    const hidden = INSPECTIONS.filter((i) => i.hidden).map((i) => i.type).sort();
    expect(hidden).toEqual(['contradiction', 'missing_backing', 'missing_warrant', 'unsupported_claim']);
    expect(INSPECTIONS.filter((i) => i.hidden).every((i) => i.group === 'arguments')).toBe(true);
    expect(visibleInspections().some((i) => i.group === 'arguments')).toBe(false);
  });

  it('gives every visible check a label and a description a user could act on', () => {
    for (const def of visibleInspections()) {
      expect(def.label.length, def.type).toBeGreaterThan(3);
      expect(def.description.length, def.type).toBeGreaterThan(20);
    }
  });

  it('folds the two duplicate-source types onto one switch', () => {
    expect(catalogTypeFor('source_duplicate_uri')).toBe('source_duplicate_doi');
    expect(catalogTypeFor('source_duplicate_doi')).toBe('source_duplicate_doi');
    expect(catalogTypeFor('stale_note')).toBe('stale_note');
  });
});

describe('isInspectionEnabled', () => {
  it('is on by default — a new check needs no migration to run', () => {
    for (const def of INSPECTIONS) {
      expect(isInspectionEnabled(def.type, DEFAULT_INSPECTION_SETTINGS), def.type).toBe(true);
    }
  });

  it('honours the deny-list for visible checks', () => {
    const settings = { ...DEFAULT_INSPECTION_SETTINGS, disabled: ['stale_note'] };
    expect(isInspectionEnabled('stale_note', settings)).toBe(false);
    expect(isInspectionEnabled('broken_note_link', settings)).toBe(true);
  });

  it('keeps hidden checks running even if a config names them', () => {
    // Hidden is about VISIBILITY. Nothing in the UI could have written this,
    // and honouring it would silently kill a check the user can't switch back on.
    const settings = { ...DEFAULT_INSPECTION_SETTINGS, disabled: ['unsupported_claim'] };
    expect(isInspectionEnabled('unsupported_claim', settings)).toBe(true);
  });
});
