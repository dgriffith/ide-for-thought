/**
 * @vitest-environment node
 *
 * The 2026-10-02 security review's High and Medium findings stay
 * regression-tested (#2570). Every finding in findings.ts names tests that
 * exist. A finding that travels inside a shared thoughtbase names a
 * hostile-thoughtbase fixture that is really exported, and that at least
 * one of its tests uses. Deleting or renaming a fixture, or a test that drives
 * it, fails here, with the finding's ID in the message.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FINDINGS } from './findings';
import * as hostile from '../helpers/hostile-thoughtbase';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('security review findings stay regression-tested (#2570)', () => {
  it('covers H1–H3 and M1–M6, once each', () => {
    expect(FINDINGS.map((f) => f.id)).toEqual(['H1', 'H2', 'H3', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6']);
  });

  for (const f of FINDINGS) {
    describe(`${f.id}: ${f.summary}`, () => {
      it('names regression tests that exist', () => {
        expect(f.tests.length).toBeGreaterThan(0);
        for (const t of f.tests) expect(fs.existsSync(path.join(ROOT, t)), `${f.id}: ${t} is missing`).toBe(true);
      });

      if (f.fixture) {
        const fixture = f.fixture;
        it(`its fixture ${fixture} is exported by hostile-thoughtbase.ts and driven by a test`, () => {
          expect(fixture in hostile, `${f.id}: ${fixture} is not exported by tests/helpers/hostile-thoughtbase.ts`).toBe(true);
          const users = f.tests.filter((t) => new RegExp(`\\b${fixture}\\b`).test(read(t)));
          expect(users, `${f.id}: no listed test uses ${fixture}`).not.toEqual([]);
        });
      } else {
        it('says why no thoughtbase fixture applies', () => {
          expect(f.noFixture?.length ?? 0, `${f.id}: fixture is null but noFixture is empty`).toBeGreaterThan(20);
        });
      }
    });
  }
});
