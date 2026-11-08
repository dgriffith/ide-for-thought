// TEMPORARY probe for #3026 — never merged. Spawns Electron on the stdin probe
// with piped input, the way the e2e spec runs the CLI, per reading method.
const { spawnSync } = require('node:child_process');
const [electron, probe] = process.argv.slice(2);
for (const m of ['process-stdin', 'readsync', 'readstream']) {
  const r = spawnSync(electron, [probe, m], { input: 'hello-from-node\n', encoding: 'utf8', timeout: 15000 });
  console.log(`=== ${m} (node spawnSync input): status=${r.status} stdout=${JSON.stringify(r.stdout)}`);
}
