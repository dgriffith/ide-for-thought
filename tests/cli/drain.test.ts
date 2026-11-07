/**
 * @vitest-environment node
 *
 * The CLI exits only once its output is flushed (#3023): on an asynchronous
 * pipe, `process.exit` straight after a write dropped what was still queued.
 */
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { drained } from '../../src/cli/drain';

describe('drained', () => {
  it('resolves only after earlier writes have been flushed', async () => {
    const flushed: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = new Writable({
      write(chunk: Buffer, _enc, cb) {
        void gate.then(() => { flushed.push(chunk.toString()); cb(); });
      },
    });
    slow.write('{"id":1}\n');
    slow.write('{"id":2}\n');
    let done = false;
    const wait = drained(slow).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false);
    release();
    await wait;
    expect(flushed.join('')).toBe('{"id":1}\n{"id":2}\n');
  });

  it('resolves when the reader has gone away', async () => {
    const broken = new Writable({ write(_c, _e, cb) { cb(new Error('EPIPE')); } });
    broken.on('error', () => {});
    await expect(drained(broken)).resolves.toBeUndefined();
  });

  it('resolves when write throws', async () => {
    await expect(drained({ write: () => { throw new Error('destroyed'); } })).resolves.toBeUndefined();
  });
});
