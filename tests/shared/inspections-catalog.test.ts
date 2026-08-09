/**
 * The inspection catalog (#1792) — the contract between the engine, the
 * settings panel, and the config file.
 *
 * The interesting failure isn't a wrong label; it's DRIFT. A check that exists
 * in the engine but not the catalog can never be switched off; a catalog entry
 * with no engine behind it is a switch that controls nothing. Both look fine in
 * review and only show up when a user flips a toggle and nothing happens — so
 * the catalog is checked against the engine source here.
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

/** Every `type: '…'` the engine actually emits. */
function enginesEmittedTypes(): Set<string> {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'graph', 'health-checks.ts'),
    'utf-8',
  );
  const found = new Set<string>();
  for (const m of src.matchAll(/^\s*type: '([a-z_]+)',/gm)) found.add(m[1]!);
  return found;
}

describe('inspection catalog', () => {
  it('covers every check the engine emits', () => {
    const cataloged = new Set(INSPECTIONS.map((i) => i.type));
    const uncovered = [...enginesEmittedTypes()]
      .filter((t) => !cataloged.has(catalogTypeFor(t)));
    expect(uncovered, 'engine emits these with no catalog entry — they can never be switched off').toEqual([]);
  });

  it('has no entry the engine never emits', () => {
    const emitted = enginesEmittedTypes();
    const orphans = INSPECTIONS
      .map((i) => i.type)
      .filter((t) => !emitted.has(t) && ![...emitted].some((e) => catalogTypeFor(e) === t));
    expect(orphans, 'catalog entries with no engine behind them — switches that do nothing').toEqual([]);
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
