/**
 * @vitest-environment node
 *
 * A plugin ingestor whose parser is a tool on its own MCP server (#2880),
 * end to end against the Book Shelf example: a real `node` server, the real
 * registry and gate, and `ingestSource` as the Ingest URL dialog calls it.
 * A page on its host and a `shelf:` id both become a Source written by
 * Minerva; an identifier still goes to Minerva first; a plain web page is
 * still Minerva's; its command runs on the server too (#2879); and with its
 * server off, the ingest fails naming it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _disablePluginsForTests, enablePlugins, reloadPluginScan } from '../../../src/main/plugins/registry';
import { silenceLogTags } from '../../helpers/quiet-logs';

vi.mock('electron', () => ({ BrowserWindow: { getFocusedWindow: () => null }, dialog: {}, app: {} }));
vi.mock('../../../src/main/mcp-servers/config-store', () => ({
  getStoredServers: async () => [],
  addStoredServer: vi.fn(),
  removeStoredServer: vi.fn(),
  setStoredServerEnabled: vi.fn(),
  updateStoredServer: vi.fn(),
}));
const web = vi.hoisted(() => ({ ingestUrl: vi.fn() }));
vi.mock('../../../src/main/sources/ingest', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/sources/ingest')>()),
  ingestUrl: web.ingestUrl,
}));

import { reconcilePluginServers, setServerEnabled } from '../../../src/main/mcp-servers/registry';
import { _setLocalMcpServersOnForTests } from '../../../src/main/mcp-servers/registry';

// These run stdio servers, which need Local MCP servers on (#2891).
_setLocalMcpServersOnForTests(true);
import { configureMcpToolPermissionsPath } from '../../../src/main/mcp-servers/tool-permissions';
import { shutdownAllMcpClients } from '../../../src/main/mcp-client';
import { installPluginIngestors } from '../../../src/main/plugin-ingestors';
import { ingestSource, setExtraIngestors } from '../../../src/main/sources/ingestors';
import { runPluginCommand } from '../../../src/main/plugin-commands';

silenceLogTags('plugins', 'secrets', 'mcp-confirm', 'mcp-servers');

const FIXTURE = path.resolve(__dirname, '..', '..', 'fixtures', 'plugins', 'book-shelf');

describe('Book Shelf: a site read through its plugin\'s MCP server (#2880)', () => {
  let tmp: string;
  let dir: string;
  let root: string;

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-book-shelf-')));
    dir = path.join(tmp, 'plugins');
    root = path.join(tmp, 'tb');
    fs.mkdirSync(root);
    fs.cpSync(FIXTURE, path.join(dir, 'book-shelf'), { recursive: true });
    configureMcpToolPermissionsPath(path.join(tmp, 'mcp-tool-permissions.json'));
    enablePlugins({ appVersion: '4.0.0', dir });
    await reloadPluginScan();
    installPluginIngestors();
    web.ingestUrl.mockReset().mockResolvedValue({ sourceId: 'web', relativePath: 'x', duplicate: false, title: 'A page' });
  });
  afterEach(async () => {
    setExtraIngestors(null);
    _disablePluginsForTests();
    await reconcilePluginServers();
    await shutdownAllMcpClients();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('a page on its host becomes a Source its server read and Minerva wrote', async () => {
    await setServerEnabled('plugin:book-shelf/catalogue', true);
    const made = await ingestSource(root, { kind: 'text', text: 'https://www.books.example/books/42' });
    expect(made).toMatchObject({ route: 'url', kind: 'web', duplicate: false, title: 'The Hitchhiker’s Guide to the Galaxy' });
    const dirOf = path.join(root, '.minerva', 'sources', made.sourceId);
    const meta = fs.readFileSync(path.join(dirOf, 'meta.ttl'), 'utf-8');
    expect(meta).toContain('this: a thought:Book ;');
    expect(meta).toContain('dc:creator "Douglas Adams" ;');
    expect(meta).toContain('bibo:uri "https://books.example/books/42" ;');
    expect(meta).toContain('minerva:ingestedBy "plugin:book-shelf@1.0.0" ;');
    expect(meta).not.toContain('originalFilename');
    expect(fs.readFileSync(path.join(dirOf, 'body.md'), 'utf-8')).toContain('Far out in the uncharted backwaters');
    expect(web.ingestUrl).not.toHaveBeenCalled();
    // The same page again is the same Source.
    expect(await ingestSource(root, { kind: 'text', text: 'https://www.books.example/books/42' })).toMatchObject({ duplicate: true, sourceId: made.sourceId });
  });

  it('so does a shelf: id, in any case', async () => {
    await setServerEnabled('plugin:book-shelf/catalogue', true);
    expect(await ingestSource(root, { kind: 'text', text: 'SHELF:42' })).toMatchObject({ duplicate: false, title: 'The Hitchhiker’s Guide to the Galaxy' });
  });

  it('a page elsewhere is still Minerva\'s; a book it hasn\'t got fails, naming it', async () => {
    await setServerEnabled('plugin:book-shelf/catalogue', true);
    await ingestSource(root, { kind: 'text', text: 'https://example.org/books/42' });
    expect(web.ingestUrl).toHaveBeenCalledWith(root, 'https://example.org/books/42', {});
    await expect(ingestSource(root, { kind: 'text', text: 'shelf:7' })).rejects.toThrow("Book Shelf's read_book failed: No book 7 on the shelf.");
  });

  it('its command runs on its server, handed the selection, and answers what to say (#2879)', async () => {
    await setServerEnabled('plugin:book-shelf/catalogue', true);
    fs.writeFileSync(path.join(root, 'a.md'), '# A\n');
    expect(await runPluginCommand(root, 'book-shelf', 'find-selection', { note: 'a.md', selection: 'hitchhiker' }))
      .toEqual({ kind: 'result', announce: 'On the shelf: The Hitchhiker’s Guide to the Galaxy (shelf:42).' });
    await expect(runPluginCommand(root, 'book-shelf', 'find-selection', { note: 'a.md' })).rejects.toThrow('needs text selected');
  });

  it('with its server off, the ingest fails, saying so', async () => {
    await expect(ingestSource(root, { kind: 'text', text: 'shelf:42' })).rejects.toThrow(/Book Shelf: .*book-shelf\.catalogue/);
  });
});
