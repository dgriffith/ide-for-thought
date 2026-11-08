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
const pick = (names: string[]) => Object.fromEntries(Object.entries(full).filter(([k]) => names.some((n) => n.toUpperCase() === k.toUpperCase())));
const SYSTEM = ['ALLUSERSPROFILE', 'PROGRAMDATA', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432', 'PUBLIC', 'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION', 'COMPUTERNAME', 'USERDOMAIN', 'USERDOMAIN_ROAMINGPROFILE', 'LOGONSERVER'];
await attempt('base + Windows system vars', { ...allowed, ...pick(SYSTEM) } as Record<string, string>);
await attempt('base + npm_config_prefix', { ...allowed, ...pick(['npm_config_prefix']) } as Record<string, string>);
for (const v of SYSTEM) {
  if (!(v.toUpperCase() in Object.fromEntries(Object.keys(full).map((k) => [k.toUpperCase(), 1])))) continue;
  await attempt(`base + ${v}`, { ...allowed, ...pick([v]) } as Record<string, string>);
}
