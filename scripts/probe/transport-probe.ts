// TEMPORARY probe for #2996 — never merged. Runs the real StdioTransport
// against the npx-launched fixture: as the app does (allowlisted env), and
// with the full environment, timing connect + tools/list.
import { StdioTransport } from '../../src/main/mcp-client/stdio-transport';
import { allowlistedEnv } from '../../src/main/subprocess-env';

const PKG = process.argv[2]!;

async function attempt(label: string, env: Record<string, string> | undefined): Promise<void> {
  const t0 = Date.now();
  const transport = new StdioTransport({ kind: 'stdio', command: 'npx', args: ['-y', PKG, 'stdio'], ...(env ? { env } : {}) });
  try {
    await transport.connect();
    const t1 = Date.now();
    console.log(`${label}: connected in ${t1 - t0}ms, era=${transport.era}`);
  } catch (e) {
    console.log(`${label}: connect FAILED after ${Date.now() - t0}ms: ${(e as Error).message}`);
  } finally {
    await transport.close().catch(() => {});
  }
}

const full = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>;
const allowed = allowlistedEnv(process.env);
const dropped = Object.keys(full).filter((k) => !(k in allowed)).sort();
console.log(`allowlist drops ${dropped.length} vars: ${dropped.join(' ')}`);
await attempt('as the app spawns it (allowlisted env)', undefined);
await attempt('with the full environment', full);
