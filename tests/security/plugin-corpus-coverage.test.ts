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

describe('the plugin code corpus table (#2832)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf-8');

  it('names each case once', () => {
    const ids = plugins.PLUGIN_CODE_CORPUS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(plugins.PLUGIN_CODE_CORPUS.map((c) => [c.id, c] as const))('%s: its fixtures make the attempt and its tests drive it', (_id, c) => {
    expect(c.fixtures.length).toBeGreaterThan(0);
    expect(c.tests.length).toBeGreaterThan(0);
    for (const f of [...c.fixtures, ...c.tests]) {
      expect(fs.existsSync(path.join(REPO, f)), `${f} doesn't exist`).toBe(true);
      expect(read(f), `${f} doesn't mention ${c.attempt}`).toContain(c.attempt);
    }
  });

  it('every attempt the hostile frame offers is a case', () => {
    const frame = read('tests/fixtures/hostile-plugins/frame/app.js');
    const block = frame.slice(frame.indexOf('window.attempts = {'));
    const offered = [...block.matchAll(/^ {2}(?:async )?([a-zA-Z]+)\(/gm)].map((m) => m[1]!);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.filter((a) => !plugins.PLUGIN_CODE_CORPUS.some((c) => c.attempt === a))).toEqual([]);
  });
});
