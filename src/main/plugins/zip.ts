/**
 * Unpacking a plugin archive (#2634). A `.zip` is someone else's input, and
 * unpacking one is the classic place to write outside the folder you meant
 * to. So every entry is checked before anything is written, and one bad
 * entry refuses the whole archive:
 *
 * - **No escaping names** ("zip-slip"): an absolute path, a drive letter, a
 *   backslash, an empty or `..` segment. yauzl refuses most of these itself
 *   (`strictFileNames`); the same rules are checked again here, and every
 *   write is checked to land inside the target folder.
 * - **No links.** A symlink entry is refused — unpacked, it could point
 *   anywhere, and a plugin is plain files (#2632).
 * - **Bounded**, against a zip bomb: the entry count, each file's size and
 *   the total are capped by what the archive declares, before anything is
 *   decompressed, and yauzl's `validateEntrySizes` stops a stream that
 *   produces more than its entry declared.
 *
 * macOS's `__MACOSX/` and `.DS_Store` debris is skipped, not refused.
 * Unpacking happens in a staging folder the installer then checks whole
 * (#2632) before anything is moved into place.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { PLUGIN_MANIFEST } from '../../shared/plugins/format';

export const ZIP_LIMITS = {
  /** The archive file itself. */
  archiveBytes: 25 * 1024 * 1024,
  entries: 2000,
  /** One unpacked file. */
  fileBytes: 10 * 1024 * 1024,
  /** Everything unpacked. */
  totalBytes: 50 * 1024 * 1024,
};

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Why `name` can't be unpacked, or null. */
function unsafeName(name: string): string | null {
  if (name.includes('\0')) return 'has a NUL character';
  if (name.includes('\\')) return 'uses a backslash';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'is an absolute path';
  const segments = name.replace(/\/$/, '').split('/');
  if (segments.some((s) => s === '' || s === '..')) return 'has an empty or ".." segment';
  return null;
}

/** macOS archive debris: skipped, not refused. */
function isDebris(name: string): boolean {
  return name.startsWith('__MACOSX/') || path.posix.basename(name) === '.DS_Store';
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * Unpack `zipPath` into `dest` (which must not exist yet). Throws, naming the
 * entry, on anything unsafe; on a throw `dest` may hold a partial unpack, which
 * the caller's staging cleanup removes.
 */
export async function unpackPluginZip(zipPath: string, dest: string): Promise<void> {
  const { size } = await fsp.stat(zipPath);
  if (size > ZIP_LIMITS.archiveBytes) {
    throw new Error(`The archive is ${mb(size)}; a plugin archive may be at most ${mb(ZIP_LIMITS.archiveBytes)}.`);
  }
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.openPromise(zipPath, {
      lazyEntries: true,
      autoClose: false,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
  } catch (e) {
    throw new Error(`It isn't a zip archive Minerva can read: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  const root = path.resolve(dest);
  await fsp.mkdir(root, { recursive: true });
  try {
    if (zip.entryCount > ZIP_LIMITS.entries) {
      throw new Error(`It has ${zip.entryCount} entries; a plugin archive may have at most ${ZIP_LIMITS.entries}.`);
    }
    let total = 0;
    for await (const entry of entries(zip)) {
      const name = entry.fileName;
      if (isDebris(name)) continue;
      const bad = unsafeName(name);
      if (bad) throw new Error(`"${name}" ${bad}; the archive can't be unpacked safely.`);
      const mode = (entry.externalFileAttributes >>> 16) & S_IFMT;
      if (mode === S_IFLNK) throw new Error(`"${name}" is a link; a plugin archive holds plain files only.`);

      const target = path.resolve(root, ...name.replace(/\/$/, '').split('/'));
      if (!target.startsWith(root + path.sep)) throw new Error(`"${name}" would land outside the plugin folder.`);
      if (name.endsWith('/')) {
        await fsp.mkdir(target, { recursive: true });
        continue;
      }
      if (entry.uncompressedSize > ZIP_LIMITS.fileBytes) {
        throw new Error(`"${name}" unpacks to ${mb(entry.uncompressedSize)}; one file may be at most ${mb(ZIP_LIMITS.fileBytes)}.`);
      }
      total += entry.uncompressedSize;
      if (total > ZIP_LIMITS.totalBytes) {
        throw new Error(`It unpacks to more than ${mb(ZIP_LIMITS.totalBytes)}, the most a plugin may be.`);
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const stream = await zip.openReadStreamPromise(entry);
      // `flag: 'wx'`: never write through something already there.
      await pipeline(stream, fs.createWriteStream(target, { flags: 'wx' }));
    }
  } catch (e) {
    if (e instanceof Error && /^(invalid|absolute path|strictFileNames|too many|uncompressed size|compressed size)/i.test(e.message)) {
      throw new Error(`The archive can't be unpacked safely: ${e.message}`, { cause: e });
    }
    throw e;
  } finally {
    zip.close();
  }
}

/** yauzl's entries, one at a time (`lazyEntries`), as an async iterator. */
async function* entries(zip: yauzl.ZipFile): AsyncGenerator<yauzl.Entry> {
  while (true) {
    const next = await new Promise<yauzl.Entry | null>((resolve, reject) => {
      const onEntry = (entry: yauzl.Entry) => { cleanup(); resolve(entry); };
      const onEnd = () => { cleanup(); resolve(null); };
      const onError = (err: Error) => { cleanup(); reject(err); };
      const cleanup = () => {
        zip.off('entry', onEntry);
        zip.off('end', onEnd);
        zip.off('error', onError);
      };
      zip.once('entry', onEntry);
      zip.once('end', onEnd);
      zip.once('error', onError);
      zip.readEntry();
    });
    if (!next) return;
    yield next;
  }
}

/**
 * Where the plugin is in an unpacked archive: at its root, or — the shape
 * GitHub's "Download ZIP" produces — in its single top-level folder.
 */
export async function pluginRootIn(unpacked: string): Promise<string> {
  const has = async (dir: string) => {
    try {
      return (await fsp.stat(path.join(dir, PLUGIN_MANIFEST))).isFile();
    } catch (e) {
      // Only "not there" means no manifest; anything else is a real failure.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  };
  if (await has(unpacked)) return unpacked;
  const top = (await fsp.readdir(unpacked, { withFileTypes: true })).filter((d) => !d.name.startsWith('.'));
  if (top.length === 1 && top[0]!.isDirectory() && (await has(path.join(unpacked, top[0]!.name)))) {
    return path.join(unpacked, top[0]!.name);
  }
  throw new Error(`The archive has no ${PLUGIN_MANIFEST} at its top, or in a single folder at its top.`);
}
