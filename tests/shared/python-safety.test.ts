import { describe, it, expect } from 'vitest';
import { scanPythonSafety } from '../../src/shared/python-safety';

describe('scanPythonSafety', () => {
  it('passes a typical analysis cell with no flags', () => {
    const code = `
import pandas as pd
import numpy as np

df = pd.DataFrame({ 'x': [1, 2, 3] })
print(df.describe())
`.trim();
    expect(scanPythonSafety(code)).toEqual([]);
  });

  it('flags `import os`', () => {
    const flags = scanPythonSafety('import os\n');
    expect(flags.map((f) => f.id)).toContain('imports-os');
  });

  it('flags `from os import path`', () => {
    const flags = scanPythonSafety('from os import path\n');
    expect(flags.map((f) => f.id)).toContain('imports-os');
  });

  it('flags subprocess', () => {
    const flags = scanPythonSafety('import subprocess; subprocess.run(["ls"])');
    expect(flags.map((f) => f.id)).toContain('imports-subprocess');
  });

  it('flags requests / urllib / httpx / aiohttp / socket / ssl as network', () => {
    for (const mod of ['requests', 'urllib', 'http', 'aiohttp', 'httpx', 'socket', 'ssl']) {
      const flags = scanPythonSafety(`import ${mod}`);
      expect(flags.map((f) => f.id)).toContain(`imports-${mod}`);
    }
  });

  it('flags `open(path, "w")` and friends', () => {
    expect(scanPythonSafety('open("x", "w")').map((f) => f.id)).toContain('opens-file-for-write');
    expect(scanPythonSafety('open("x", "wb")').map((f) => f.id)).toContain('opens-file-for-write');
    expect(scanPythonSafety('open("x", "a")').map((f) => f.id)).toContain('opens-file-for-write');
    expect(scanPythonSafety('open("x", "r+")').map((f) => f.id)).toContain('opens-file-for-write');
  });

  it('does NOT flag `open(path)` or explicit read mode', () => {
    expect(scanPythonSafety('open("x")').map((f) => f.id)).not.toContain('opens-file-for-write');
    expect(scanPythonSafety('open("x", "r")').map((f) => f.id)).not.toContain('opens-file-for-write');
    expect(scanPythonSafety('open("x", "rb")').map((f) => f.id)).not.toContain('opens-file-for-write');
  });

  it('flags `eval`, `exec`, `compile`, `__import__`', () => {
    expect(scanPythonSafety('eval("1+1")').map((f) => f.id)).toContain('calls-eval');
    expect(scanPythonSafety('exec("print(1)")').map((f) => f.id)).toContain('calls-exec');
    expect(scanPythonSafety('compile("x", "<s>", "exec")').map((f) => f.id)).toContain('calls-compile');
    expect(scanPythonSafety('__import__("os")').map((f) => f.id)).toContain('calls-dunder-import');
  });

  it('flags `os.system` and `os.popen` distinctly even when os is already flagged', () => {
    const flags = scanPythonSafety('import os; os.system("ls")');
    expect(flags.map((f) => f.id)).toContain('imports-os');
    expect(flags.map((f) => f.id)).toContain('os-system');
  });

  it('flags pathlib write helpers', () => {
    expect(scanPythonSafety('p.write_text("hi")').map((f) => f.id)).toContain('pathlib-write');
    expect(scanPythonSafety('p.write_bytes(b"hi")').map((f) => f.id)).toContain('pathlib-write');
  });

  it('ignores patterns that only appear inside a # comment', () => {
    const flags = scanPythonSafety('# import os\nprint("ok")');
    expect(flags).toEqual([]);
  });

  it('still flags patterns inside string literals (string-built exec is a real risk)', () => {
    const flags = scanPythonSafety('cmd = "import os"\nexec(cmd)');
    // We don't try to strip string literals, so the `eval`/`exec`
    // pattern hits regardless.
    expect(flags.map((f) => f.id)).toContain('calls-exec');
  });

  it('dedupes flag ids when a pattern matches multiple lines', () => {
    const flags = scanPythonSafety('import os\nimport os.path\n');
    const ids = flags.map((f) => f.id);
    expect(ids.filter((id) => id === 'imports-os')).toHaveLength(1);
  });

  it('catches indented imports inside try blocks', () => {
    const code = `
try:
    import socket
except ImportError:
    pass
`.trim();
    expect(scanPythonSafety(code).map((f) => f.id)).toContain('imports-socket');
  });
});
