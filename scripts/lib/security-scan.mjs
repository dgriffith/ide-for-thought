/**
 * Pure logic for ci.yml's advisory `security-scan` job (#2570): parse
 * Electronegativity's CSV and Semgrep's JSON into one finding list, then
 * compare it against `build/security-scan-baseline.json`.
 *
 * A finding's key is `tool:check:file`, with no line number, so an edit
 * elsewhere in the file doesn't make a known finding look new. Every baseline
 * entry carries the reason it was accepted. That's the point of the file: a
 * scanner's false positive gets written down and argued once, not dismissed
 * again on every run.
 */

/** @param {string} line */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Electronegativity `-o x.csv -r` output → findings. */
export function parseElectronegativityCsv(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const findings = [];
  for (const line of lines.slice(1)) {
    const [check, severity, confidence, file, location] = splitCsvLine(line);
    if (!check || !file) continue;
    findings.push({ tool: 'electronegativity', check, severity, confidence, file: normalizeFile(file), location: location ?? '' });
  }
  return findings;
}

/** Semgrep `--json` output → findings (results only; parse errors are reported separately). */
export function parseSemgrepJson(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  return (data.results ?? []).map((r) => ({
    tool: 'semgrep',
    check: r.check_id,
    severity: r.extra?.severity ?? '',
    confidence: r.extra?.metadata?.confidence ?? '',
    file: normalizeFile(r.path),
    location: `${r.start?.line ?? ''}:${r.start?.col ?? ''}`,
  }));
}

/** Paths relative to `src/`, the way Electronegativity's `-r` prints them. */
export function normalizeFile(file) {
  return String(file).replace(/\\/g, '/').replace(/^(\.\/)?(.*\/)?src\//, '');
}

export const findingKey = (f) => `${f.tool}:${f.check}:${f.file}`;

/**
 * Split findings into baselined and new; list baseline entries nothing matched
 * any more (fixed, or the file moved), so the baseline can shrink.
 * @param {Array<{tool:string,check:string,file:string}>} findings
 * @param {{ accepted: Record<string, string> }} baseline
 */
export function compareToBaseline(findings, baseline) {
  const accepted = baseline.accepted ?? {};
  const known = [];
  const fresh = [];
  const seen = new Set();
  for (const f of findings) {
    const key = findingKey(f);
    seen.add(key);
    (key in accepted ? known : fresh).push(f);
  }
  const stale = Object.keys(accepted).filter((k) => !seen.has(k));
  return { known, fresh, stale };
}

/** Markdown for the job summary. */
export function renderSummary({ known, fresh, stale }, { semgrepParseErrors = 0 } = {}) {
  const row = (f) => `| ${f.tool} | \`${f.check}\` | ${f.severity} | \`${f.file}:${f.location}\` |`;
  const lines = ['## Security scan (advisory)', ''];
  lines.push(`${fresh.length} new · ${known.length} accepted in \`build/security-scan-baseline.json\` · ${stale.length} stale baseline entr${stale.length === 1 ? 'y' : 'ies'}`);
  if (semgrepParseErrors) lines.push('', `Semgrep could not fully parse ${semgrepParseErrors} file(s); those parts went unscanned.`);
  if (fresh.length) {
    lines.push('', '### New findings', '', '| tool | check | severity | where |', '|---|---|---|---|', ...fresh.map(row));
    lines.push('', 'Fix it, or add its key to the baseline with the reason it is safe.');
  }
  if (stale.length) lines.push('', '### Baseline entries that matched nothing', '', ...stale.map((k) => `- \`${k}\``), '', 'Remove them so the baseline shrinks.');
  return lines.join('\n') + '\n';
}
