/**
 * Installing a plugin from a git URL (#2634): the URL rules, the bounded
 * fetch (through a fake transport — nothing here touches the network) and the
 * checkout, which walks a repository's tree itself so that a hostile one —
 * links, submodules, `.git` names, too much of it — is refused whole.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GitHttpRequest, HttpClient } from 'isomorphic-git';
import { checkoutPluginTree, fetchPluginRepo, parseGitPluginSpec } from '../../../src/main/plugins/git';
import { ZIP_LIMITS } from '../../../src/main/plugins/zip';
import { buildRepo } from '../../helpers/git-repo';

let tmp: string;
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-git-'))); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('parseGitPluginSpec (#2634)', () => {
  it('takes an https URL, with an optional #pin; SSH spellings become https', () => {
    expect(parseGitPluginSpec(' https://github.com/ada/lab ')).toEqual({ url: 'https://github.com/ada/lab' });
    expect(parseGitPluginSpec('https://github.com/ada/lab.git#v1.2.0')).toEqual({ url: 'https://github.com/ada/lab.git', ref: 'v1.2.0' });
    expect(parseGitPluginSpec('git@github.com:ada/lab.git#release/2')).toEqual({ url: 'https://github.com/ada/lab.git', ref: 'release/2' });
    expect(parseGitPluginSpec('https://github.com/ada/lab#7fd1a60')).toEqual({ url: 'https://github.com/ada/lab', ref: '7fd1a60' });
  });

  it.each([
    ['plain http', 'http://example.com/lab', /https:\/\/ only.*uses http/],
    ['file://', 'file:///Users/ada/lab', /https:\/\/ only.*uses file/],
    ['a local path', '/Users/ada/lab', /isn't a git repository URL/],
    ['credentials', 'https://ada:secret@github.com/ada/lab', /user name or password/],
    ['a query', 'https://github.com/ada/lab?x=1', /query string/],
    ['a ".." in the pin', 'https://github.com/ada/lab#../main', /isn't a tag, branch or commit name/],
    ['an option-looking pin', 'https://github.com/ada/lab#--upload-pack=x', /isn't a tag, branch or commit name/],
  ])('refuses %s', (_what, raw, msg) => {
    expect(() => parseGitPluginSpec(raw)).toThrow(msg);
  });
});

/** A transport answering every request with `res` (a function of the request). */
const transport = (res: (req: GitHttpRequest) => Promise<Awaited<ReturnType<HttpClient['request']>>>): HttpClient => ({ request: res });

describe('fetchPluginRepo (#2634)', () => {
  const spec = { url: 'https://git.example/ada/lab' };
  const LIMITS = { downloadBytes: 1024, timeoutMs: 5_000 };

  it('sends no credentials, and a refusal from the server says to use a zip for a private repository', async () => {
    const seen: GitHttpRequest[] = [];
    const http = transport(async (req) => {
      seen.push(req);
      return { url: req.url, method: req.method, statusCode: 401, statusMessage: 'Unauthorized', headers: {}, body: undefined };
    });
    await expect(fetchPluginRepo(spec, path.join(tmp, 'repo'), http, LIMITS)).rejects.toThrow(/public git repository at https:\/\/git\.example\/ada\/lab \(HTTP 401\).*Install from zip/);
    expect(seen.length).toBeGreaterThan(0);
    for (const req of seen) expect(Object.keys(req.headers ?? {}).map((h) => h.toLowerCase())).not.toContain('authorization');
  });

  it('stops a download past its byte cap', async () => {
    const http = transport(async (req) => ({
      url: req.url, method: req.method, statusCode: 200, statusMessage: 'OK',
      headers: { 'content-type': 'application/x-git-upload-pack-advertisement' },
      // One chunk past the cap: it's refused before anything parses it.
      body: (async function* () { for (;;) yield new Uint8Array(4096); })(),
    }));
    await expect(fetchPluginRepo(spec, path.join(tmp, 'repo'), http, LIMITS)).rejects.toThrow(/over 0 MB to download, more than a plugin may be/);
  });

  it('stops a fetch that takes too long', async () => {
    const http = transport((req) => new Promise((_resolve, reject) => {
      req.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await expect(fetchPluginRepo(spec, path.join(tmp, 'repo'), http, { ...LIMITS, timeoutMs: 30 })).rejects.toThrow(/took more than 0 seconds/);
  });
});

describe('checkoutPluginTree (#2634)', () => {
  const dest = () => path.join(tmp, 'tree');

  it('writes an honest tree: nested folders and files', async () => {
    const [repo, commit] = await buildRepo(path.join(tmp, 'repo'), {
      'plugin.json': '{}',
      types: { 'sample.md': 'Sample', deeper: { 'x.md': 'x' } },
    });
    await checkoutPluginTree(repo, commit, dest());
    expect(fs.readFileSync(path.join(dest(), 'types', 'deeper', 'x.md'), 'utf-8')).toBe('x');
    expect(fs.readFileSync(path.join(dest(), 'plugin.json'), 'utf-8')).toBe('{}');
  });

  it.each([
    ['a link', { 'plugin.json': '{}', 'evil.md': { link: '/etc/passwd' } }, /"evil\.md" is a link/],
    ['a submodule', { 'plugin.json': '{}', vendor: { submodule: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d' } }, /"vendor" is a submodule/],
  ])('refuses %s whole, and writes nothing outside', async (_what, tree, msg) => {
    const [repo, commit] = await buildRepo(path.join(tmp, 'repo'), tree);
    await expect(checkoutPluginTree(repo, commit, dest())).rejects.toThrow(msg);
    expect(fs.readdirSync(tmp).sort()).toEqual(['repo', 'tree']);
  });

  // A `.git` segment is refused too, but isomorphic-git won't write such a
  // tree to test it with (`writeTree` refuses the name), so it's unreachable
  // through this library today; the check stays for a fetched pack.

  it('refuses too many entries, a file too big, and too much in all', async () => {
    const [repo, commit] = await buildRepo(path.join(tmp, 'repo'), { 'a.md': 'aaaa', 'b.md': 'bbbb', 'c.md': 'cccc' });
    await expect(checkoutPluginTree(repo, commit, path.join(tmp, 't1'), { ...ZIP_LIMITS, entries: 2 })).rejects.toThrow(/more than 2 files/);
    await expect(checkoutPluginTree(repo, commit, path.join(tmp, 't2'), { ...ZIP_LIMITS, fileBytes: 3 })).rejects.toThrow(/"a\.md" is .*one file may be at most/);
    await expect(checkoutPluginTree(repo, commit, path.join(tmp, 't3'), { ...ZIP_LIMITS, totalBytes: 10 })).rejects.toThrow(/the most a plugin may be/);
  });
});
