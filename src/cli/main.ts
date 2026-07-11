#!/usr/bin/env node
/**
 * Executable entry for the Minerva CLI (#1149, epic #1145 — Substrate).
 *
 * A thin shell over `runCli`: parse argv, run, write, exit. Every bit of logic
 * lives in `./run` so it stays testable without spawning a process. Built as a
 * standalone Node bundle via `vite.cli.config.ts` → `.vite/build/cli.js`.
 */
import { runCli } from './run';

/** Read all of stdin (the `propose-note` note body). Returns '' at a TTY, so an
 *  interactive invocation without a pipe doesn't hang waiting for input. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const stdin = argv[0] === 'propose-note' ? await readStdin() : undefined;
  const result = await runCli(argv, { cwd: process.cwd(), stdin });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}

void main();
