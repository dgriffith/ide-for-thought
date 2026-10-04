#!/usr/bin/env node
/**
 * ci.yml `security-scan` job (#2570): read Electronegativity's CSV and
 * Semgrep's JSON, compare against build/security-scan-baseline.json, write the
 * job summary, and annotate each new finding with a ::warning. Exits 0 either
 * way. The job is advisory until the baseline has settled.
 *
 *   node scripts/security-scan-report.mjs <electronegativity.csv> <semgrep.json>
 *   node scripts/security-scan-report.mjs <csv> <json> --update   # re-bless (keeps reasons)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseElectronegativityCsv, parseSemgrepJson, compareToBaseline, renderSummary, findingKey,
} from './lib/security-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'build', 'security-scan-baseline.json');
const [csvPath, jsonPath, flag] = process.argv.slice(2);

const read = (p) => (p && fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null);
const csv = read(csvPath);
const json = read(jsonPath);
if (csv == null) console.log(`::warning title=security-scan::Electronegativity produced no report (${csvPath})`);
if (json == null) console.log(`::warning title=security-scan::Semgrep produced no report (${jsonPath})`);

const semgrep = json ? JSON.parse(json) : { results: [], errors: [] };
const findings = [...(csv ? parseElectronegativityCsv(csv) : []), ...parseSemgrepJson(semgrep)];
const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));

if (flag === '--update') {
  const accepted = {};
  for (const f of findings) accepted[findingKey(f)] = baseline.accepted?.[findingKey(f)] ?? 'TODO: why this is safe';
  fs.writeFileSync(BASELINE, JSON.stringify({ ...baseline, accepted }, null, 2) + '\n');
  console.log(`baseline: ${Object.keys(accepted).length} entries`);
  process.exit(0);
}

const result = compareToBaseline(findings, baseline);
const parseErrors = (semgrep.errors ?? []).length;
const summary = renderSummary(result, { semgrepParseErrors: parseErrors });
process.stdout.write(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
for (const f of result.fresh) {
  const [line] = f.location.split(':');
  console.log(`::warning file=src/${f.file},line=${line || 1},title=${f.tool}: ${f.check}::New security-scan finding (advisory). Fix it, or baseline it with a reason in build/security-scan-baseline.json.`);
}
