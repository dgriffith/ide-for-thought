#!/usr/bin/env node
/**
 * Executable entry for the Minerva CLI (#1149, epic #1145 — Substrate).
 *
 * A thin shell over `runCli`: parse argv, run, write, exit. Every bit of logic
 * lives in `./run` so it stays testable without spawning a process. Built as a
 * standalone Node bundle via `vite.cli.config.ts` → `.vite/build/cli.js`.
 */
import { runCli } from './run';

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2), { cwd: process.cwd() });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}

void main();
