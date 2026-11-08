// TEMPORARY probe for #3026 — never merged. Run as Electron's main process:
//   echo hello | electron.exe scripts/probe/stdin-probe.cjs <method>
// and report whether piped stdin arrives, by each way of reading it.
const fs = require('node:fs');
const { app } = require('electron');
const method = process.argv[process.argv.length - 1];
const out = (s) => { process.stdout.write(s + '\n'); fs.appendFileSync('probe-result.txt', `${method}: ${s}\n`); };
const finish = () => setTimeout(() => app.exit(0), 200);
out(`stdin: ${process.stdin && process.stdin.constructor && process.stdin.constructor.name} isTTY=${process.stdin && process.stdin.isTTY} fd0=${(() => { try { return fs.fstatSync(0).isFIFO() ? 'fifo' : fs.fstatSync(0).isFile() ? 'file' : 'other'; } catch (e) { return 'ERR ' + e.code; } })()}`);
if (method === 'process-stdin') {
  let got = '';
  const t = setTimeout(() => { out(`timeout, got=${JSON.stringify(got)}`); finish(); }, 4000);
  process.stdin.on('data', (d) => { got += d; });
  process.stdin.on('end', () => { clearTimeout(t); out(`end, got=${JSON.stringify(got)}`); finish(); });
  process.stdin.on('error', (e) => { clearTimeout(t); out(`error ${e.code || e.message}`); finish(); });
} else if (method === 'readsync') {
  try { const b = Buffer.alloc(100); const n = fs.readSync(0, b, 0, 100, null); out(`read ${n} bytes: ${JSON.stringify(b.subarray(0, n).toString())}`); } catch (e) { out(`error ${e.code || e.message}`); }
  finish();
} else if (method === 'readstream') {
  let got = '';
  const s = fs.createReadStream(null, { fd: 0, autoClose: false });
  const t = setTimeout(() => { out(`timeout, got=${JSON.stringify(got)}`); finish(); }, 4000);
  s.on('data', (d) => { got += d; });
  s.on('end', () => { clearTimeout(t); out(`end, got=${JSON.stringify(got)}`); finish(); });
  s.on('error', (e) => { clearTimeout(t); out(`error ${e.code || e.message}`); finish(); });
} else {
  out('unknown method'); finish();
}
