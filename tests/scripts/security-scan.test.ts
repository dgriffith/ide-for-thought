/**
 * The advisory security-scan job's comparison logic (#2570).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseElectronegativityCsv, parseSemgrepJson, compareToBaseline, renderSummary, findingKey, normalizeFile,
} from '../../scripts/lib/security-scan.mjs';

const CSV = [
  'issue, severity, confidence, filename, location, sample, description, url',
  'SANDBOX_JS_CHECK,"MEDIUM","FIRM","main/window-manager.ts","151:14","const win = new BrowserWindow({","Use sandbox, ""really""",https://x',
  'OPEN_EXTERNAL_JS_CHECK,"MEDIUM","TENTATIVE","main/new.ts","9:3","shell.openExternal(u)","Review",https://y',
  '',
].join('\n');

const SEMGREP = {
  results: [{ check_id: 'semgrep.minerva-spawn-inherits-process-env', path: 'src/main/x/run.ts', start: { line: 4, col: 2 }, extra: { severity: 'ERROR' } }],
  errors: [{}, {}],
};

describe('security-scan parsing (#2570)', () => {
  it('reads Electronegativity CSV, including quoted commas and doubled quotes', () => {
    const f = parseElectronegativityCsv(CSV);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ tool: 'electronegativity', check: 'SANDBOX_JS_CHECK', severity: 'MEDIUM', file: 'main/window-manager.ts', location: '151:14' });
  });

  it('reads Semgrep JSON, with paths normalised to the CSV form', () => {
    expect(parseSemgrepJson(SEMGREP)[0]).toMatchObject({ tool: 'semgrep', file: 'main/x/run.ts', location: '4:2', severity: 'ERROR' });
    expect(normalizeFile('/home/runner/work/repo/src/renderer/a.ts')).toBe('renderer/a.ts');
  });
});

describe('compareToBaseline', () => {
  const findings = [...parseElectronegativityCsv(CSV), ...parseSemgrepJson(SEMGREP)];

  it('splits baselined from new by tool:check:file, ignoring line numbers', () => {
    const baseline = { accepted: { 'electronegativity:SANDBOX_JS_CHECK:main/window-manager.ts': 'spread', 'semgrep:gone:main/old.ts': 'fixed since' } };
    const r = compareToBaseline(findings, baseline);
    expect(r.known.map(findingKey)).toEqual(['electronegativity:SANDBOX_JS_CHECK:main/window-manager.ts']);
    expect(r.fresh.map((f) => f.file)).toEqual(['main/new.ts', 'main/x/run.ts']);
    expect(r.stale).toEqual(['semgrep:gone:main/old.ts']);
  });

  it('the summary names new findings, stale entries and unparsed files', () => {
    const md = renderSummary(compareToBaseline(findings, { accepted: {} }), { semgrepParseErrors: 2 });
    expect(md).toMatch(/3 new · 0 accepted/);
    expect(md).toMatch(/`main\/new\.ts:9:3`/);
    expect(md).toMatch(/could not fully parse 2 file/);
  });
});

describe('the committed baseline', () => {
  it('gives every accepted finding a real reason', () => {
    const b = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'build', 'security-scan-baseline.json'), 'utf-8')) as { accepted: Record<string, string> };
    for (const [key, reason] of Object.entries(b.accepted)) {
      expect(key).toMatch(/^(electronegativity|semgrep):[^:]+:(main|renderer|preload|shared|cli)\//);
      expect(reason.length, key).toBeGreaterThan(20);
      expect(reason, key).not.toMatch(/TODO/);
    }
  });
});
