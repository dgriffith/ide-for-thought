/**
 * What the `minerva-plugin:` protocol serves (#2824): a file inside the
 * plugin's folder, for an enabled plugin that declares `ui`, under the frame
 * CSP — and nothing else, whatever the request spells.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginPackage, PluginScan } from '../../../src/shared/plugins/format';

const h = vi.hoisted((): { scan: PluginScan } => ({ scan: { plugins: [], errors: [] } }));
vi.mock('../../../src/main/plugins/registry', () => ({ getPluginScan: async () => h.scan }));

import {
  parsePluginFrameRequest,
  pluginFrameCsp,
  pluginFrameRoot,
  resolvePluginFrameFile,
  _servePluginFrameForE2E,
} from '../../../src/main/plugins/frame-files';

let tmp: string;
let root: string;
const rootFor = async (id: string) => (id === 'hostile' ? root : null);

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-frame-')));
  root = path.join(tmp, 'hostile');
  fs.mkdirSync(path.join(root, 'views'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'index.html'), '<p>index</p>');
  fs.writeFileSync(path.join(root, 'views', 'board.js'), '// board');
  fs.writeFileSync(path.join(root, '.git', 'config'), 'secret');
  fs.writeFileSync(path.join(tmp, 'outside.txt'), 'outside-canary');
  fs.symlinkSync(path.join(tmp, 'outside.txt'), path.join(root, 'link-out.txt'));
  fs.symlinkSync(tmp, path.join(root, 'dir-out'));
  fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'link-in.html'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => { h.scan = { plugins: [], errors: [] }; });

describe('parsePluginFrameRequest (#2824)', () => {
  it('names the plugin and the in-folder path; / is index.html; query and hash are ignored', () => {
    expect(parsePluginFrameRequest('minerva-plugin://hostile/')).toEqual({ id: 'hostile', rel: 'index.html' });
    expect(parsePluginFrameRequest('minerva-plugin://hostile/views/board.js?v=2#x')).toEqual({ id: 'hostile', rel: 'views/board.js' });
    expect(parsePluginFrameRequest('minerva-plugin://hostile/a%20b.html')).toEqual({ id: 'hostile', rel: 'a b.html' });
  });

  it('refuses another scheme, a backslash, NUL, a malformed escape, and any skipped segment', () => {
    for (const url of [
      'app://minerva/index.html',
      'minerva-plugin://hostile/views%5C..%5C..%5Cx',
      'minerva-plugin://hostile/a%00.html',
      'minerva-plugin://hostile/%E0%A4%A',
      'minerva-plugin://hostile/.git/config',
      'minerva-plugin://hostile/%2egit/config',
      'minerva-plugin://hostile/node_modules/x.js',
      'minerva-plugin://hostile/.env',
      'not a url',
    ]) {
      expect(parsePluginFrameRequest(url), url).toBeNull();
    }
  });

  it('keeps `..` inside the folder: the URL is resolved against its root before it reaches us', () => {
    expect(parsePluginFrameRequest('minerva-plugin://hostile/../../etc/hosts')).toEqual({ id: 'hostile', rel: 'etc/hosts' });
    expect(parsePluginFrameRequest('minerva-plugin://hostile/%2e%2e/%2e%2e/etc/hosts')).toEqual({ id: 'hostile', rel: 'etc/hosts' });
  });
});

describe('resolvePluginFrameFile (#2824)', () => {
  it('serves a file inside the folder, a link that stays inside included', async () => {
    expect(await resolvePluginFrameFile('minerva-plugin://hostile/', rootFor)).toBe(path.join(root, 'index.html'));
    expect(await resolvePluginFrameFile('minerva-plugin://hostile/views/board.js', rootFor)).toBe(path.join(root, 'views', 'board.js'));
    expect(await resolvePluginFrameFile('minerva-plugin://hostile/link-in.html', rootFor)).toBe(path.join(root, 'index.html'));
  });

  it('refuses a link that leaves the folder, a folder, a missing file and an id with no frame', async () => {
    for (const url of [
      'minerva-plugin://hostile/link-out.txt',
      'minerva-plugin://hostile/dir-out/outside.txt',
      'minerva-plugin://hostile/views',
      'minerva-plugin://hostile/missing.html',
      'minerva-plugin://hostile/.git/config',
      'minerva-plugin://nobody/index.html',
    ]) {
      expect(await resolvePluginFrameFile(url, rootFor), url).toBeNull();
    }
  });
});

describe('pluginFrameRoot (#2824)', () => {
  const pkg = (id: string, capabilities?: string[]): PluginPackage => ({
    manifest: { id, name: id, version: '1.0.0', ...(capabilities ? { code: { capabilities } } : {}) } as PluginPackage['manifest'],
    root: `/plugins/${id}`,
    contributions: [],
    provenance: `plugin:${id}@1.0.0`,
  });

  it('is the folder of an enabled plugin that declares ui, and nothing for any other', async () => {
    h.scan = { plugins: [pkg('board', ['ui', 'notes:read']), pkg('reader', ['notes:read']), pkg('plain')], errors: [] };
    expect(await pluginFrameRoot('board')).toBe('/plugins/board');
    expect(await pluginFrameRoot('reader')).toBeNull(); // code, but no ui
    expect(await pluginFrameRoot('plain')).toBeNull();  // no code at all
    expect(await pluginFrameRoot('absent')).toBeNull(); // disabled or not installed: not in the scan
  });

  it('serves the e2e fixture it was told to', async () => {
    _servePluginFrameForE2E('e2e-fixture', '/fixtures/frame');
    expect(await pluginFrameRoot('e2e-fixture')).toBe('/fixtures/frame');
  });
});

describe('pluginFrameCsp (#2824)', () => {
  const csp = pluginFrameCsp(['app://minerva']);
  const directive = (name: string) => csp.match(new RegExp(`(?:^|; )${name} ([^;]+)`))?.[1];

  it('allows its own origin for scripts and nothing for the network, frames, plugins or forms', () => {
    expect(directive('default-src')).toBe("'none'");
    expect(directive('script-src')).toBe("'self'");
    expect(directive('connect-src')).toBe("'none'");
    expect(directive('frame-src')).toBe("'none'");
    expect(directive('object-src')).toBe("'none'");
    expect(directive('form-action')).toBe("'none'");
    expect(directive('base-uri')).toBe("'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(directive('script-src')).not.toContain('unsafe-inline');
  });

  it('may be framed only by the embedders it names, and sandboxes itself however it is framed', () => {
    expect(directive('frame-ancestors')).toBe('app://minerva');
    expect(pluginFrameCsp(['app://minerva', 'http://localhost:5173'])).toContain('frame-ancestors app://minerva http://localhost:5173');
    expect(directive('sandbox')).toBe('allow-scripts allow-same-origin');
  });
});
