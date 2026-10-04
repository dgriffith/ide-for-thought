/**
 * The env allowlist for children that run code Minerva didn't write (#2560).
 */
import { describe, it, expect } from 'vitest';
import { allowlistedEnv, KERNEL_ENV_EXTRA } from '../../src/main/subprocess-env';

const SOURCE: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/Users/me',
  USER: 'me',
  LOGNAME: 'me',
  SHELL: '/bin/zsh',
  TERM: 'xterm-256color',
  LANG: 'en_GB.UTF-8',
  LC_ALL: 'en_GB.UTF-8',
  LC_CTYPE: 'UTF-8',
  TMPDIR: '/var/folders/x/T/',
  TZ: 'Europe/London',
  // credentials a shell commonly exports
  ANTHROPIC_API_KEY: 'sk-ant-x',
  OPENAI_API_KEY: 'sk-x',
  GH_TOKEN: 'ghp_x',
  GITHUB_TOKEN: 'ghs_x',
  AWS_ACCESS_KEY_ID: 'AKIA',
  AWS_SECRET_ACCESS_KEY: 'secret',
  NPM_TOKEN: 'npm_x',
  // Electron / Node process plumbing a child must not inherit
  ELECTRON_RUN_AS_NODE: '1',
  NODE_OPTIONS: '--require /tmp/evil.js',
  // interpreter discovery
  VIRTUAL_ENV: '/Users/me/venv',
  PYENV_ROOT: '/Users/me/.pyenv',
  PYENV_VERSION: '3.12.1',
  CONDA_PREFIX: '/opt/conda/envs/x',
  CONDA_DEFAULT_ENV: 'x',
  SSL_CERT_FILE: '/etc/ssl/cert.pem',
  // an exported shell function (bash `export -f`)
  BASH_FUNC_x: '() { echo hi; }',
};

describe('allowlistedEnv (#2560)', () => {
  it('keeps the base set and drops credentials and process plumbing', () => {
    const env = allowlistedEnv(SOURCE, {}, 'darwin');
    expect(env).toEqual({
      PATH: '/usr/bin:/bin', HOME: '/Users/me', USER: 'me', LOGNAME: 'me', SHELL: '/bin/zsh',
      TERM: 'xterm-256color', LANG: 'en_GB.UTF-8', LC_ALL: 'en_GB.UTF-8', LC_CTYPE: 'UTF-8',
      TMPDIR: '/var/folders/x/T/', TZ: 'Europe/London',
    });
  });

  it('the kernel extra adds interpreter discovery and CA bundles — still no credentials', () => {
    const env = allowlistedEnv(SOURCE, KERNEL_ENV_EXTRA, 'darwin');
    expect(env).toMatchObject({
      VIRTUAL_ENV: '/Users/me/venv', PYENV_ROOT: '/Users/me/.pyenv', PYENV_VERSION: '3.12.1',
      CONDA_PREFIX: '/opt/conda/envs/x', CONDA_DEFAULT_ENV: 'x', SSL_CERT_FILE: '/etc/ssl/cert.pem',
    });
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'NPM_TOKEN', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) {
      expect(env[k], k).toBeUndefined();
    }
  });

  it('skips exported shell functions even under an allowed name', () => {
    expect(allowlistedEnv({ PATH: '() { :; }; curl evil' }, {}, 'darwin')).toEqual({});
  });

  it('matches names case-insensitively on Windows only', () => {
    const src = { Path: 'C:\\\\Windows', SystemRoot: 'C:\\\\Windows', path_lower: 'x' };
    expect(allowlistedEnv(src, {}, 'win32')).toEqual({ Path: 'C:\\\\Windows', SystemRoot: 'C:\\\\Windows' });
    expect(allowlistedEnv(src, {}, 'darwin')).toEqual({});
  });

  it('a prefix must match from the start', () => {
    expect(allowlistedEnv({ MY_LC_ALL: 'x', XCONDA_PREFIX: 'y' }, KERNEL_ENV_EXTRA, 'darwin')).toEqual({});
  });
});
