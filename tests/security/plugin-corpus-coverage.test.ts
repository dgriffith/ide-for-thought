/**
 * @vitest-environment node
 *
 * The negative plugin corpus's table (`PLUGIN_CORPUS`, #2655) is held to the
 * tests: every case's test files exist and use its builder, and every
 * builder in `hostile-plugins.ts` is a case. A table nobody checks becomes a
 * list that claims coverage it doesn't have, as `findings-coverage.test.ts`
 * says of the security findings.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as plugins from '../helpers/hostile-plugins';
import * as thoughtbases from '../helpers/hostile-thoughtbase';

const REPO = path.resolve(__dirname, '..', '..');

describe('the plugin corpus table (#2655)', () => {
  it('names each case once', () => {
    const ids = plugins.PLUGIN_CORPUS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(plugins.PLUGIN_CORPUS.map((c) => [c.id, c] as const))('%s: its builder exists and each of its tests uses it', (_id, c) => {
    expect(c.builder in plugins || c.builder in thoughtbases, `${c.builder} is exported by neither hostile helper`).toBe(true);
    expect(c.tests.length).toBeGreaterThan(0);
    for (const t of c.tests) {
      const file = path.join(REPO, t);
      expect(fs.existsSync(file), `${t} doesn't exist`).toBe(true);
      expect(fs.readFileSync(file, 'utf-8'), `${t} doesn't use ${c.builder}`).toContain(c.builder);
    }
  });

  it('every builder in hostile-plugins.ts is a case', () => {
    const builders = Object.keys(plugins).filter((k) => k.startsWith('build'));
    expect(builders.filter((b) => !plugins.PLUGIN_CORPUS.some((c) => c.builder === b))).toEqual([]);
  });
});
