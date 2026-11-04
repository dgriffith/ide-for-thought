/**
 * @vitest-environment node
 *
 * On Windows a stdio MCP server is usually launched through a `.cmd` shim
 * (`npx`, `uvx`), which runs under cmd.exe — so every argument has to arrive
 * intact and none may be read as a cmd operator (#2980). The transport spawns
 * with cross-spawn for exactly this; this test runs a shim with hostile
 * arguments and reads back what the program behind it received. Windows only:
 * elsewhere there's no cmd.exe to fool, and spawn passes argv directly.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';

const WIN = process.platform === 'win32';

describe.skipIf(!WIN)('a .cmd shim gets its arguments intact (#2980)', () => {
  const dir = WIN ? fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cmd-shim-')) : '';
  afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('passes &, |, ^, %VAR%, quotes and spaces through, and runs nothing else', async () => {
    const script = path.join(dir, 'echo-args.js');
    const marker = path.join(dir, 'INJECTED');
    fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    // What npm writes for a bin: node, the script, every argument (%*).
    fs.writeFileSync(path.join(dir, 'echoargs.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
    const hostile = [
      'plain', 'with space', `& echo pwned > "${marker}"`, 'a|b', 'caret^x', '%PATH%', 'say "hi"', '',
    ];
    const child = spawn('echoargs', hostile, { env: { ...process.env, PATH: `${dir};${process.env.PATH ?? ''}` } });
    let out = '';
    child.stdout!.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual(hostile);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
