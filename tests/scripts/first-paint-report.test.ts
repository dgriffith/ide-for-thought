/**
 * Packaged-app time-to-first-paint trend (#2384): the report is a record, not
 * a gate. These pin the parsing, the one annotation per test, and that the CLI
 * exits 0 whatever it finds — including nothing at all.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatFirstPaintReport, parseFirstPaintRows } from '../../scripts/lib/first-paint-report.mjs';

const T = 'smoke.spec.ts › packaged app opens a DuckDB-backed project';
const good = { test: T, retry: 0, sample: { trigger: 'ready-to-show', uptimeMs: 640, spawnToPaintMs: 910 } };

describe('first-paint report (#2384)', () => {
  it('parses JSONL, skipping a torn last line', () => {
    const rows = parseFirstPaintRows(`${JSON.stringify(good)}\n\n{"test":"x","ret`);
    expect(rows).toEqual([good]);
  });

  it('tables every attempt and notices the number the test settled on', () => {
    const retried = { ...good, retry: 1, sample: { ...good.sample, spawnToPaintMs: 1200 } };
    const { markdown, annotations } = formatFirstPaintReport([{ ...good, sample: null }, retried], { label: 'ci' });
    expect(markdown).toContain('— ci');
    expect(markdown).toContain('| 1 | — | no mark |');
    expect(markdown).toContain('| 2 | ready-to-show | 1200 ms | 640 ms |');
    expect(annotations).toEqual([
      '::notice title=first-paint::1200 ms spawn → first paint (640 ms main uptime, ready-to-show)',
    ]);
  });

  it('warns — never fails — when the mark is missing or the timer showed the window', () => {
    expect(formatFirstPaintReport([{ ...good, sample: null }]).annotations[0]).toMatch(/^::warning .*no first-paint mark/);
    const timer = { ...good, sample: { ...good.sample, trigger: 'timeout' } };
    expect(formatFirstPaintReport([timer]).annotations[0]).toMatch(/^::warning .*fallback timer/);
    expect(formatFirstPaintReport([]).annotations[0]).toMatch(/^::warning .*No first-paint samples/);
  });

  it('the CLI exits 0 and writes the job summary, with or without samples', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-paint-report-'));
    try {
      const summary = path.join(dir, 'summary.md');
      const jsonl = path.join(dir, 'first-paint.jsonl');
      fs.writeFileSync(jsonl, `${JSON.stringify(good)}\n`);
      const script = path.resolve(__dirname, '../../scripts/first-paint-report.mjs');
      const env = { ...process.env, GITHUB_STEP_SUMMARY: summary };
      execFileSync(process.execPath, [script, jsonl], { env });
      execFileSync(process.execPath, [script, path.join(dir, 'missing.jsonl')], { env });
      const written = fs.readFileSync(summary, 'utf-8');
      expect(written).toContain('910 ms');
      expect(written).toContain('No samples recorded');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
