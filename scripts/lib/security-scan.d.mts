/** Types for `security-scan.mjs` (#2570). */
export interface ScanFinding {
  tool: 'electronegativity' | 'semgrep';
  check: string;
  severity: string;
  confidence: string;
  file: string;
  location: string;
}
export interface ScanBaseline { accepted: Record<string, string> }
export interface ScanComparison { known: ScanFinding[]; fresh: ScanFinding[]; stale: string[] }
export function parseElectronegativityCsv(csv: string): ScanFinding[];
export function parseSemgrepJson(json: string | object): ScanFinding[];
export function normalizeFile(file: string): string;
export function findingKey(f: Pick<ScanFinding, 'tool' | 'check' | 'file'>): string;
export function compareToBaseline(findings: ScanFinding[], baseline: ScanBaseline): ScanComparison;
export function renderSummary(c: ScanComparison, opts?: { semgrepParseErrors?: number }): string;
