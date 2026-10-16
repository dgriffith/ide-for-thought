/**
 * Build a zip archive byte by byte, for tests (#2634).
 *
 * The point is being able to build archives a well-behaved writer refuses to:
 * an entry named `../escape.md` or `/etc/x`, a symlink entry, a size that
 * lies. That's what the plugin zip installer has to survive, so its tests
 * need to make them. Stored or deflated entries, Unix modes, no zip64.
 */
import zlib from 'node:zlib';

export interface ZipEntry {
  name: string;
  /** File contents. Omit for a directory entry (name ending `/`). */
  data?: Buffer | string;
  /** A symlink entry pointing here (its contents are the target). */
  symlink?: string;
  method?: 'store' | 'deflate';
  /** Lie about the uncompressed size in the headers. */
  declaredSize?: number;
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf-8');
    const isDir = e.name.endsWith('/') && e.data === undefined && e.symlink === undefined;
    const raw = Buffer.from(e.symlink ?? e.data ?? '');
    const method = e.method === 'deflate' ? 8 : 0;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = zlib.crc32(raw);
    const size = e.declaredSize ?? raw.length;
    // Unix mode in the high 16 bits: symlink, directory or regular file.
    const mode = e.symlink !== undefined ? 0o120777 : isDir ? 0o040755 : 0o100644;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
