/**
 * The plugin API is an ABI (#2826). `plugin-api/` — the runtime Minerva serves
 * to plugin frames, its types, and the ABI snapshot — is generated from
 * `src/shared/plugins/api.ts`, the table the broker enforces. This holds:
 *
 *  - the committed package is exactly what the generator makes from api.ts
 *    now, so a change to the surface is a re-bless that shows in the diff;
 *  - api.ts is well-formed: every method is core (`<area>.<name>`) or a fork's
 *    extension (`<slug>:<name>`), with params and a result;
 *  - the snapshot's version is PLUGIN_API_VERSION, and the generator refuses
 *    a breaking change without a major bump (tested in
 *    tests/scripts/plugin-api-gen.test.ts);
 *  - what the protocol serves at /@minerva/plugin-api.js is that file.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  abiOf, checkApi, CORE_METHOD, generateAbiJson, generateDts, generateJs, readApiSource,
} from '../../scripts/lib/plugin-api-gen.mjs';
import { PLUGIN_API_VERSION, PLUGIN_METHODS } from '../../src/shared/plugins/api';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const api = readApiSource(read('src/shared/plugins/api.ts'));

describe('the plugin API package matches the broker table (#2826)', () => {
  it('api.ts is well-formed', () => {
    expect(checkApi(api)).toEqual([]);
    expect(Object.keys(api.methods).sort()).toEqual(Object.keys(PLUGIN_METHODS).sort());
    expect(api.version).toBe(PLUGIN_API_VERSION);
  });

  it.each([
    ['plugin-api/index.js', () => generateJs(api)],
    ['plugin-api/index.d.ts', () => generateDts(api)],
    ['plugin-api/abi.json', () => generateAbiJson(api)],
  ])('%s is what the generator makes now', (rel, make) => {
    expect(
      read(rel) === make(),
      `${rel} is stale. Run \`node scripts/build-plugin-api.mjs\` — it refuses a breaking change without a major bump of PLUGIN_API_VERSION, and an addition without a minor one.`,
    ).toBe(true);
  });

  it('the snapshot covers every core method, at the current version', () => {
    const snapshot = JSON.parse(read('plugin-api/abi.json')) as ReturnType<typeof abiOf>;
    expect(snapshot.version).toBe(PLUGIN_API_VERSION);
    expect(Object.keys(snapshot.methods).sort()).toEqual(Object.keys(PLUGIN_METHODS).filter((m) => CORE_METHOD.test(m)).sort());
  });

  it('the protocol serves the generated runtime, not a copy', () => {
    expect(read('src/main/plugin-protocol.ts')).toMatch(/from '\.\.\/\.\.\/plugin-api\/index\.js\?raw'/);
  });
});
