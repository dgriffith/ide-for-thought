// TEMPORARY probe for #2996 — never merged. On Windows, spawn the MCP fixture
// server the way StdioTransport does (cross-spawn, `npx -y …`) and see which
// writes reach it: immediately, after a delay, or only once it has spoken.
const spawn = require('cross-spawn');
const PKG = process.argv[2];
const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;
const init = (id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } }) + '\n';

function run(label, command, args, plan) {
  return new Promise((resolve) => {
    const p = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const got = [];
    let firstOut = null;
    p.stdout.on('data', (d) => { if (firstOut === null) firstOut = ms(); for (const l of String(d).split('\n').filter(Boolean)) { try { got.push(JSON.parse(l).id); } catch { got.push('?' + l.slice(0, 40)); } } });
    p.stderr.on('data', (d) => { if (firstOut === null) firstOut = `stderr@${ms()}`; });
    plan(p);
    setTimeout(() => { console.log(`${label}: answered ids=${JSON.stringify(got)} firstOutput=${firstOut}`); p.kill(); resolve(); }, 20000);
  });
}

(async () => {
  console.log(`node ${process.version}, pkg ${PKG}`);
  await run('npx, write at once (ids 1,2)', 'npx', ['-y', PKG, 'stdio'], (p) => { p.stdin.write(init(1)); p.stdin.write(init(2)); });
  await run('npx, write after 8s (id 3)', 'npx', ['-y', PKG, 'stdio'], (p) => { setTimeout(() => p.stdin.write(init(3)), 8000); });
  await run('npx, write at once (1) then again after 8s (2)', 'npx', ['-y', PKG, 'stdio'], (p) => { p.stdin.write(init(1)); setTimeout(() => p.stdin.write(init(2)), 8000); });
  await run('cmd /c npx, write at once (ids 1,2)', 'cmd', ['/c', 'npx', '-y', PKG, 'stdio'], (p) => { p.stdin.write(init(1)); p.stdin.write(init(2)); });
})();
