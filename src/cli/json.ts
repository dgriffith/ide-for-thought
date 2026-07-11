/**
 * BigInt-safe JSON for the CLI + MCP layers (#1149/#1146).
 *
 * DuckDB returns BigInt for integer columns, which `JSON.stringify` can't
 * serialize. Safe integers become plain numbers; anything outside the safe range
 * becomes a string to avoid silent precision loss. Shared so the CLI (pretty
 * stdout) and the MCP server (compact tool-result text) format identically.
 */
export function bigintSafeReplacer(_key: string, v: unknown): unknown {
  if (typeof v !== 'bigint') return v;
  return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(v)
    : v.toString();
}

export function jsonStringify(value: unknown, pretty = false): string {
  return JSON.stringify(value, bigintSafeReplacer, pretty ? 2 : undefined);
}
