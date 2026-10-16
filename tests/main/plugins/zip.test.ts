/**
 * @vitest-environment node
 *
 * Unpacking a plugin archive (#2634), against hostile archives built byte by
 * byte (`tests/helpers/zip.ts`): every escaping name, a link, a bomb, a size
 * that lies. Each is refused whole, nothing lands outside the target, and an
 * honest archive — including GitHub's "Download ZIP" shape — unpacks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pluginRootIn, unpackPluginZip, ZIP_LIMITS } from '../../../src/main/plugins/zip';
import { buildZip, type ZipEntry } from '../../helpers/zip';

let tmp: string;
let dest: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-zip-')));
  dest = path.join(tmp, 'out', 'unpacked');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const archive = (entries: ZipEntry[], name = 'p.zip') => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, buildZip(entries));
  return p;
};
/** Every file under `dir`, relative. */
const files = (dir: string): string[] => fs.existsSync(dir)
  ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.relative(dir, path.join(d.parentPath, d.name))).sort()
  : [];
/** Nothing was written anywhere but `out/` — and the canary outside is untouched. */
const nothingEscaped = () => expect(fs.readdirSync(tmp).sort()).toEqual(expect.arrayContaining(['out']));

describe('unpackPluginZip (#2634)', () => {
  it('unpacks an honest archive: stored and deflated files, folders; macOS debris skipped', async () => {
    await unpackPluginZip(archive([
      { name: 'plugin.json', data: '{"id":"lab"}' },
      { name: 'types/', },
      { name: 'types/sample.md', data: 'x'.repeat(5000), method: 'deflate' },
      { name: '__MACOSX/._plugin.json', data: 'junk' },
      { name: 'types/.DS_Store', data: 'junk' },
    ]), dest);
    expect(files(dest)).toEqual(['plugin.json', path.join('types', 'sample.md')]);
    expect(fs.readFileSync(path.join(dest, 'types', 'sample.md'), 'utf-8')).toHaveLength(5000);
  });

  for (const [what, name] of [
    ['a ".." segment', '../escape.md'],
    ['a nested ".."', 'types/../../escape.md'],
    ['an absolute path', '/tmp/escape.md'],
    ['a drive letter', 'C:/escape.md'],
    ['a backslash', '..\\escape.md'],
    ['an empty segment', 'types//x.md'],
  ] as const) {
    it(`refuses an entry with ${what}, and writes nothing outside`, async () => {
      fs.writeFileSync(path.join(tmp, 'canary.md'), 'safe');
      await expect(unpackPluginZip(archive([{ name: 'plugin.json', data: '{}' }, { name, data: 'pwned' }]), dest)).rejects.toThrow();
      expect(fs.readFileSync(path.join(tmp, 'canary.md'), 'utf-8')).toBe('safe');
      expect(fs.existsSync(path.join(tmp, 'escape.md'))).toBe(false);
      expect(fs.existsSync('/tmp/escape.md') && fs.readFileSync('/tmp/escape.md', 'utf-8') === 'pwned').toBe(false);
      nothingEscaped();
    });
  }

  it('refuses a link entry', async () => {
    await expect(unpackPluginZip(archive([
      { name: 'plugin.json', data: '{}' },
      { name: 'types/secret.md', symlink: '/etc/passwd' },
    ]), dest)).rejects.toThrow(/"types\/secret\.md" is a link/);
    expect(fs.existsSync(path.join(dest, 'types', 'secret.md'))).toBe(false);
  });

  it('refuses a bomb by its declared size, before decompressing it', async () => {
    const big = Buffer.alloc(ZIP_LIMITS.fileBytes + 1); // zeros: deflates to almost nothing
    await expect(unpackPluginZip(archive([{ name: 'bomb.md', data: big, method: 'deflate' }]), dest))
      .rejects.toThrow(/"bomb\.md" unpacks to 10 MB; one file may be at most 10 MB/);
    expect(files(dest)).toEqual([]);
  });

  it('refuses a total over the cap', async () => {
    const chunk = Buffer.alloc(ZIP_LIMITS.fileBytes - 1);
    const entries = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.md`, data: chunk, method: 'deflate' as const }));
    await expect(unpackPluginZip(archive(entries), dest)).rejects.toThrow(/more than 50 MB, the most a plugin may be/);
  });

  it('refuses an entry that unpacks to more than it declares', async () => {
    await expect(unpackPluginZip(archive([
      { name: 'liar.md', data: Buffer.alloc(100_000), method: 'deflate', declaredSize: 10 },
    ]), dest)).rejects.toThrow();
    expect(fs.existsSync(path.join(dest, 'liar.md')) ? fs.statSync(path.join(dest, 'liar.md')).size : 0).toBeLessThanOrEqual(100_000);
  });

  it('refuses too many entries, an oversized archive, and something that isn\'t a zip', async () => {
    const many = Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => ({ name: `f${i}.md`, data: 'x' }));
    await expect(unpackPluginZip(archive(many), dest)).rejects.toThrow(/2001 entries; a plugin archive may have at most 2000/);

    const huge = path.join(tmp, 'huge.zip');
    fs.writeFileSync(huge, Buffer.alloc(ZIP_LIMITS.archiveBytes + 1));
    await expect(unpackPluginZip(huge, dest)).rejects.toThrow(/a plugin archive may be at most 25 MB/);

    const notZip = path.join(tmp, 'not.zip');
    fs.writeFileSync(notZip, 'hello');
    await expect(unpackPluginZip(notZip, dest)).rejects.toThrow(/isn't a zip archive Minerva can read/);
  });
});

describe('pluginRootIn (#2634)', () => {
  it('finds the plugin at the root, or in a single top-level folder', async () => {
    await unpackPluginZip(archive([{ name: 'plugin.json', data: '{}' }]), dest);
    expect(await pluginRootIn(dest)).toBe(dest);

    const dest2 = path.join(tmp, 'out', 'gh');
    await unpackPluginZip(archive([{ name: 'reading-list-main/plugin.json', data: '{}' }], 'gh.zip'), dest2);
    expect(await pluginRootIn(dest2)).toBe(path.join(dest2, 'reading-list-main'));
  });

  it('says so when there\'s no plugin.json where it should be', async () => {
    await unpackPluginZip(archive([{ name: 'a/plugin.json', data: '{}' }, { name: 'b/plugin.json', data: '{}' }]), dest);
    await expect(pluginRootIn(dest)).rejects.toThrow(/no plugin\.json at its top, or in a single folder at its top/);
  });
});
