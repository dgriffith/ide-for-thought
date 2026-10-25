/**
 * Plugin ingestors (#2647): main reads the file and hands the handler its
 * name and bytes with nothing in scope; only a well-formed draft becomes a
 * Source, its body escaped so it is text and never HTML, its meta.ttl naming
 * the plugin. A file already ingested never reaches the plugin again. The
 * worker host itself is `plugin-worker-host.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useTempDir } from '../helpers/temp-project';
import type { PluginIngestor } from '../../src/shared/plugins/format';

const h = vi.hoisted(() => ({
  identity: null as Record<string, unknown> | null,
  active: [] as { pluginId: string; ingestor: PluginIngestor }[],
  invoke: vi.fn(),
  tool: vi.fn(),
}));
vi.mock('../../src/main/plugins/code-plugins', () => ({ codePluginIdentity: () => h.identity, activePluginIngestors: () => h.active }));
vi.mock('../../src/main/plugin-worker-host', () => ({ invokePluginLogic: h.invoke }));
vi.mock('../../src/main/plugin-mcp-tools', () => ({ callPluginTool: h.tool }));

import { checkedDraft, ingestWithPlugin, pluginIngestors, PLUGIN_INGEST_MAX_FILE_BYTES } from '../../src/main/plugin-ingestors';

const SRT: PluginIngestor = { id: 'transcript', label: 'Transcript', accepts: { extensions: ['.srt'] }, parse: { handler: 'parseTranscript' } };
const tmp = useTempDir('plugin-ingest-');

function file(name: string, content: string | Buffer): string {
  const p = path.join(tmp.root, 'outside', name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
const sourceFile = (id: string, f: string) => fs.readFileSync(path.join(tmp.root, '.minerva', 'sources', id, f), 'utf-8');

beforeEach(() => {
  h.identity = { id: 'transcripts', name: 'Transcripts', version: '1.2.0', capabilities: ['notes:read'] };
  h.active = [{ pluginId: 'transcripts', ingestor: SRT }];
  h.invoke.mockReset();
  h.tool.mockReset();
});

describe('ingestWithPlugin (#2647)', () => {
  it('hands the handler the file as data with nothing in scope, and writes the draft as a Source', async () => {
    const p = file('Keynote.srt', '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
    h.invoke.mockResolvedValue({ title: 'Keynote', body: '**[0:01]** Hi <img src=x onerror=alert(1)>', creators: ['Ada'], issued: '2024-05', language: 'en' });
    const r = await ingestWithPlugin(tmp.root, 'transcripts', SRT, { file: p });

    expect(h.invoke).toHaveBeenCalledWith('transcripts', 'parseTranscript',
      { ingestor: 'transcript', filename: 'Keynote.srt', base64: fs.readFileSync(p).toString('base64') },
      { rootPath: tmp.root, scope: [] });
    expect(r).toMatchObject({ duplicate: false, title: 'Keynote', kind: 'text' });
    expect(sourceFile(r.sourceId, 'body.md')).toBe('**[0:01]** Hi \\<img src=x onerror=alert(1)>\n');
    const ttl = sourceFile(r.sourceId, 'meta.ttl');
    expect(ttl).toContain('this: a thought:Document ;');
    expect(ttl).toContain('dc:creator "Ada" ;');
    expect(ttl).toContain('dc:issued "2024-05"^^xsd:gYearMonth ;');
    expect(ttl).toContain('minerva:originalFilename "Keynote.srt" ;');
    expect(ttl).toContain('minerva:ingestedBy "plugin:transcripts@1.2.0" ;');
  });

  it('answers a file it has already read without running the plugin', async () => {
    const p = file('a.srt', 'same bytes');
    h.invoke.mockResolvedValue({ title: 'First "one"', body: 'x' });
    const first = await ingestWithPlugin(tmp.root, 'transcripts', SRT, { file: p });
    const again = await ingestWithPlugin(tmp.root, 'transcripts', SRT, { file: file('b.srt', 'same bytes') });
    expect(again).toEqual({ ...first, duplicate: true, title: 'First "one"' });
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it('refuses a file over the limit, and a plugin that is off, before running anything', async () => {
    const big = file('big.srt', Buffer.alloc(PLUGIN_INGEST_MAX_FILE_BYTES + 1));
    await expect(ingestWithPlugin(tmp.root, 'transcripts', SRT, { file: big })).rejects.toThrow('Transcripts reads files up to 640 KB; big.srt is 641 KB.');
    h.identity = null;
    await expect(ingestWithPlugin(tmp.root, 'transcripts', SRT, { file: file('c.srt', 'x') })).rejects.toThrow('"transcripts" is not an enabled plugin with code.');
    expect(h.invoke).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmp.root, '.minerva'))).toBe(false);
  });

  it('writes nothing when the draft is bad', async () => {
    h.invoke.mockResolvedValue({ title: 'T', body: 'x', path: '../../etc' });
    await expect(ingestWithPlugin(tmp.root, 'transcripts', SRT, { file: file('d.srt', 'x') }))
      .rejects.toThrow('Transcripts\'s Transcript ingestor returned something that isn\'t a source: unknown field "path".');
    expect(fs.existsSync(path.join(tmp.root, '.minerva'))).toBe(false);
  });
});

describe('checkedDraft (#2647)', () => {
  const check = (answer: unknown) => checkedDraft('P', 'X', answer);
  it('keeps what a draft may say, trimmed, and drops what is empty', () => {
    expect(check({ title: ' T ', body: 'b', type: 'Book', creators: [' Ada '], publisher: ' ', uri: 'https://e.org/x' }))
      .toEqual({ title: 'T', body: 'b', type: 'Book', creators: ['Ada'], uri: 'https://e.org/x' });
  });
  it.each([
    [null, 'not an object'],
    [{ body: 'b' }, '"title" must be a non-empty string'],
    [{ title: 'T' }, '"body" must be a string'],
    [{ title: 'T', body: 'b', type: 'Proposal' }, '"type" must be one of'],
    [{ title: 'T', body: 'b', creators: ['a', 3] }, '"creators" must be a list'],
    [{ title: 'T', body: 'b', issued: 'May 2024' }, '"issued" must be an ISO date'],
    [{ title: 'T', body: 'b', uri: 'javascript:alert(1)' }, '"uri" must be an http(s) URL'],
    [{ title: 'T', body: 'b', language: 'en"; x' }, '"language" must be a language tag'],
    [{ title: 'x'.repeat(501), body: 'b' }, '"title" is over 500 characters'],
  ])('refuses %j', (answer, why) => {
    expect(() => check(answer)).toThrow(why);
  });
});

describe('pluginIngestors (#2647)', () => {
  it('registers each enabled ingestor under the plugin, routed as a file', async () => {
    const [ingestor] = pluginIngestors();
    expect(ingestor).toMatchObject({ id: 'plugin:transcripts/transcript', label: 'Transcript', accepts: { extensions: ['.srt'] } });
    h.invoke.mockResolvedValue({ title: 'T', body: 'b' });
    await expect(ingestor!.ingest(tmp.root, file('e.srt', 'e'), {})).resolves.toMatchObject({ route: 'file', title: 'T' });
  });
});

describe('ingestors whose parser is an MCP tool (#2880)', () => {
  const PAGE: PluginIngestor = { id: 'page', label: 'Book page', accepts: { urlMatch: ['books.example'] }, parse: { mcpTool: 'catalogue/read_book' } };
  const ID: PluginIngestor = { id: 'shelf', label: 'Shelf id', accepts: { identifierPrefixes: ['shelf:'] }, parse: { mcpTool: 'catalogue/read_book' } };

  it('hands its tool the URL, records the page as the Source\'s uri, and is a web Source', async () => {
    h.tool.mockResolvedValue({ title: 'Dune', body: 'Spice.', type: 'Book' });
    const r = await ingestWithPlugin(tmp.root, 'transcripts', PAGE, { url: 'https://books.example/books/1' });
    expect(h.tool).toHaveBeenCalledWith('Transcripts', 'transcripts', 'catalogue/read_book', { ingestor: 'page', url: 'https://books.example/books/1' });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(r).toMatchObject({ kind: 'web', title: 'Dune', duplicate: false });
    const ttl = sourceFile(r.sourceId, 'meta.ttl');
    expect(ttl).toContain('bibo:uri "https://books.example/books/1" ;');
    expect(ttl).not.toContain('originalFilename');
  });

  it('an identifier is the same Source in any case, and its own uri wins', async () => {
    h.tool.mockResolvedValue({ title: 'Dune', body: 'Spice.', uri: 'https://books.example/canonical/1' });
    const first = await ingestWithPlugin(tmp.root, 'transcripts', ID, { identifier: 'shelf:1' });
    expect(sourceFile(first.sourceId, 'meta.ttl')).toContain('bibo:uri "https://books.example/canonical/1" ;');
    expect(await ingestWithPlugin(tmp.root, 'transcripts', ID, { identifier: 'SHELF:1' })).toMatchObject({ duplicate: true, sourceId: first.sourceId });
    expect(h.tool).toHaveBeenCalledTimes(1);
  });

  it('registers a site and a prefix as the registry dispatches them', () => {
    h.active = [{ pluginId: 'transcripts', ingestor: PAGE }, { pluginId: 'transcripts', ingestor: ID }];
    expect(pluginIngestors().map((i) => i.accepts)).toEqual([{ urlHosts: ['books.example'] }, { identifierPrefixes: ['shelf:'] }]);
  });
});

