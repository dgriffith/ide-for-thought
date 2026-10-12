/**
 * The extension-point catalog (#2617): every record validates, ids are unique,
 * and every link — contract, docs, example, harness — points at something that
 * exists. A catalog that names a moved file or a renamed symbol tells an agent
 * something false with confidence, which is worse than no catalog.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_POINTS, RUNGS, extensionPointsOn, type ExtensionPoint } from '../../../src/shared/extensions/points';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const POINTS = EXTENSION_POINTS as readonly ExtensionPoint[];
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe('extension points', () => {
  it('ids are unique and kebab-case', () => {
    const ids = POINTS.map((p) => p.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('every record says what it is, in words', () => {
    for (const p of POINTS) {
      expect(p.label.length, p.id).toBeGreaterThan(2);
      expect(p.description.length, p.id).toBeGreaterThan(20);
      expect(RUNGS, p.id).toContain(p.rung);
      expect(p.sources.length, p.id).toBeGreaterThan(0);
    }
  });

  it('a source seam is built-in only and needs a rebuild; any other has a parser and a format', () => {
    for (const p of POINTS) {
      if (p.rung === 'source') {
        expect(p.contract.kind, p.id).toBe('registry');
        expect(p.loadPath, p.id).toBe('rebuild');
        expect(p.sources, p.id).toEqual(['stock']);
      } else {
        expect(p.contract.kind, p.id).toBe('parser');
        expect(p.loadPath, p.id).not.toBe('rebuild');
        expect(p.contract.kind === 'parser' && p.contract.format.length > 5, p.id).toBe(true);
        expect(p.location, `${p.id} names where a contribution goes`).toBeTruthy();
      }
    }
  });

  it('every contract points at a file that declares its symbol', () => {
    const broken: string[] = [];
    for (const p of POINTS) {
      const { file, symbol } = p.contract.at;
      if (!exists(file)) { broken.push(`${p.id}: ${file} is missing`); continue; }
      if (!symbol) continue;
      const src = fs.readFileSync(path.join(ROOT, file), 'utf-8');
      const declared = new RegExp(`\\b(?:const|let|function|class|interface|type)\\s+${symbol}\\b`).test(src);
      if (!declared) broken.push(`${p.id}: ${file} declares no ${symbol}`);
    }
    expect(broken).toEqual([]);
  });

  it('every docs / example / harness link exists', () => {
    const broken = POINTS.flatMap((p) => (['docs', 'example', 'harness'] as const)
      .filter((k) => p[k] !== undefined && !exists(p[k]))
      .map((k) => `${p.id}.${k}: ${p[k]}`));
    expect(broken).toEqual([]);
  });

  it('a seam that has a registries-epic story is a source seam', () => {
    for (const p of POINTS.filter((x) => x.story !== undefined)) expect(p.rung, p.id).toBe('source');
  });

  it('extensionPointsOn reads one rung, in declared order', () => {
    expect(extensionPointsOn('skill').map((p) => p.id)).toEqual(['skills']);
    expect(RUNGS.flatMap((r) => extensionPointsOn(r)).length).toBe(POINTS.length);
  });
});
