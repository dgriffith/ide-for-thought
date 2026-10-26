/**
 * @vitest-environment node
 *
 * The plugin-code worked example in `docs/authoring-plugins.md` (#2833) is
 * real: the manifest and code the doc shows are Note Stats' own
 * (`tests/fixtures/plugins/note-stats/`), byte for byte; it's an accepted
 * plugin with code, hashed for approval; and every capability the doc's table
 * lists is one a third-party plugin may declare, and only those. It runs in
 * `tests/e2e/plugin-third-party-code.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readPluginPackage } from '../../../src/main/plugins/package';
import { validatePluginManifest } from '../../../src/main/plugins/manifest';
import { PLUGIN_CAPABILITIES, type PluginCapability } from '../../../src/shared/plugins/capabilities';
import { PLUGIN_API_VERSION } from '../../../src/shared/plugins/api';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'plugins', 'note-stats');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'authoring-plugins.md'), 'utf-8');
const SECTION = DOC.slice(DOC.indexOf('## Plugin code'), DOC.indexOf('\n## ', DOC.indexOf('## Plugin code') + 1));
const read = (rel: string) => fs.readFileSync(path.join(FIXTURE, rel), 'utf-8');
const blocks = (lang: string) => [...SECTION.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]!);
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version as string;

describe('the plugin-code example (#2833)', () => {
  it("the doc shows Note Stats' own manifest, page and logic", () => {
    expect(blocks('json')).toEqual([read('plugin.json')]);
    expect(blocks('js')).toEqual([read('panel/app.js'), read('logic.js')]);
  });

  it('is an accepted plugin with code, hashed for approval', async () => {
    const r = await readPluginPackage(FIXTURE, APP_VERSION);
    if (!r.ok) throw new Error(r.error.problems.join('\n'));
    expect(r.plugin.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.plugin.manifest.code?.views?.map((v) => v.id)).toEqual(['lengths']);
    expect(r.plugin.manifest.code?.commands?.map((c) => c.id)).toEqual(['count-selection']);
  });

  it("the doc's capability table is what a third-party plugin may declare, in the app's own words", () => {
    const rows = [...SECTION.matchAll(/^\| `([a-z:-]+)` \| (.+?) \|$/gm)].filter(([, cap]) => cap! in PLUGIN_CAPABILITIES);
    const listed = rows.map(([, cap]) => cap as PluginCapability);
    const mayDeclare = (Object.keys(PLUGIN_CAPABILITIES) as PluginCapability[]).filter((c) => validatePluginManifest({
      id: 'x', name: 'x', version: '1.0.0', minerva: '>=1.0.0', description: 'x', contributes: {}, code: { capabilities: [c], api: `^${PLUGIN_API_VERSION}` },
    }, { folder: 'x', appVersion: APP_VERSION }).ok);
    expect(listed).toEqual(mayDeclare);
    for (const [, cap, lets] of rows) expect(lets!.replace(', and only those', '')).toBe(PLUGIN_CAPABILITIES[cap as PluginCapability].describes);
    expect(SECTION).toContain(`"^${PLUGIN_API_VERSION}"`);
  });
});
