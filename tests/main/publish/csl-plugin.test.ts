/**
 * @vitest-environment node
 *
 * Citation styles and locales from plugins (#2633): bundled < plugin <
 * thoughtbase. A plugin's `.csl` is a style and its `.xml` a locale; it
 * can't replace a bundled one, a second plugin's of a taken id is skipped,
 * an invalid file is skipped, and the thoughtbase's own import still wins.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMergedLocales, getMergedStyles, USER_STYLES_DIR } from '../../../src/main/publish/csl/user-assets';
import { _disablePluginsForTests, enablePlugins } from '../../../src/main/plugins/registry';
import { writePlugin } from '../../helpers/plugins';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins');

const style = (title: string) =>
  `<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><title>${title}</title></info></style>`;
const LOCALE = '<?xml version="1.0"?><locale xmlns="http://purl.org/net/xbiblio/csl" version="1.0" xml:lang="fr-FR"></locale>';

let tmp: string;
let root: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-csl-'));
  root = path.join(tmp, 'tb');
  const plugins = path.join(tmp, 'plugins');
  fs.mkdirSync(root, { recursive: true });
  writePlugin(plugins, 'a-lab', { 'csl-styles': ['csl/lab-house.csl', 'csl/apa.csl', 'csl/broken.csl', 'csl/locales-fr-FR.xml'] }, {
    'csl/lab-house.csl': style('Lab House Style'),
    'csl/apa.csl': style('Not Really APA'),
    'csl/broken.csl': '<html>nope</html>',
    'csl/locales-fr-FR.xml': LOCALE,
  }, { name: 'Lab' });
  writePlugin(plugins, 'b-other', { 'csl-styles': ['csl/lab-house.csl'] }, { 'csl/lab-house.csl': style('Impostor') });
  enablePlugins({ appVersion: '4.0.0', dir: plugins });
});
afterEach(() => {
  _disablePluginsForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('plugin citation styles and locales (#2633)', () => {
  it('a plugin style joins the registry with its plugin; it can\'t replace a bundled one or another plugin\'s', async () => {
    const merged = await getMergedStyles(root);
    expect(merged.labels['lab-house']).toBe('Lab House Style');
    expect(merged.pluginIds.get('lab-house')).toEqual({ id: 'a-lab', name: 'Lab', version: '1.0.0' });
    expect(merged.labels.apa).toBe('APA (7th edition)');
    expect(merged.pluginIds.has('apa')).toBe(false);
    expect(merged.styles.broken).toBeUndefined();
  });

  it('the thoughtbase\'s own import of the same id wins', async () => {
    fs.mkdirSync(path.join(root, USER_STYLES_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, USER_STYLES_DIR, 'lab-house.csl'), style('Our House Style'));
    const merged = await getMergedStyles(root);
    expect(merged.labels['lab-house']).toBe('Our House Style');
    expect(merged.userIds.has('lab-house')).toBe(true);
    expect(merged.pluginIds.has('lab-house')).toBe(false);
  });

  it('a plugin locale joins the locales', async () => {
    expect((await getMergedLocales(root)).locales['fr-FR']).toBe(LOCALE);
  });
});
