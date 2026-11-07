/**
 * Wait for a stream's writes to reach the OS before the process exits (#3023).
 *
 * `process.exit` doesn't wait for pending writes. Where stdout is an
 * asynchronous pipe — the packaged binary's on Windows, and macOS pipes —
 * output still queued is dropped: `minerva mcp` on Windows lost the
 * responses it wrote last, and a large `sql` result could be cut short.
 * A zero-length write's callback runs once everything before it is flushed.
 * An error (the reader went away) resolves too: there's nobody to wait for.
 */
export function drained(stream: { write(chunk: string, cb: (err?: Error | null) => void): boolean }): Promise<void> {
  return new Promise((resolve) => {
    try {
      stream.write('', () => resolve());
    } catch {
      resolve();
    }
  });
}
