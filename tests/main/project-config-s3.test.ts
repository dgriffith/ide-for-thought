/**
 * S3 publish-target credential handling in project-config (#1444).
 *
 * The secret access key is encrypted at rest (secret-storage / safeStorage),
 * stripped from the read path (only `hasSecret` crosses to the renderer),
 * decrypted on demand for the transport, and tri-state on upsert — the same
 * contract BYOM established for LLM keys. safeStorage is mocked reversibly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn((s: string) => Buffer.from('FAKEENC:' + s, 'utf-8')),
    decryptString: vi.fn((buf: Buffer) => buf.toString('utf-8').replace(/^FAKEENC:/, '')),
  },
}));

import {
  getPublishTargets,
  getS3Credentials,
  getGitCredentials,
  upsertPublishTarget,
  removePublishTarget,
  type S3PublishTarget,
  type GitPublishTarget,
} from '../../src/main/project-config';

let root: string;
const configFile = () => path.join(root, '.minerva', 'config.json');
const secretsFile = () => path.join(root, '.minerva', 'secrets.json');
const gitignoreFile = () => path.join(root, '.minerva', '.gitignore');
const rawTargets = () => JSON.parse(fs.readFileSync(configFile(), 'utf-8')).publish.targets;
const rawSecrets = () => JSON.parse(fs.readFileSync(secretsFile(), 'utf-8')).publishTargets;

const s3: S3PublishTarget = {
  id: 's3a', kind: 's3', label: 'Site', exporter: 'static-site', bucket: 'b', region: 'auto',
  endpoint: 'https://x.r2.cloudflarestorage.com', accessKeyId: 'AKIA', secretAccessKey: 'super-secret',
};

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-pcfg-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('S3 target credentials', () => {
  it('keeps the secret out of config.json — encrypted in the gitignored secrets.json', () => {
    upsertPublishTarget(root, s3);
    const onDisk = rawTargets()[0];
    expect(onDisk.secretAccessKey).toBeUndefined();            // no plaintext
    expect(onDisk.secretAccessKeyEnc).toBeUndefined();         // no ciphertext in config either
    expect(fs.readFileSync(configFile(), 'utf-8')).not.toContain('super-secret');
    expect(onDisk.accessKeyId).toBe('AKIA');                   // non-secret fields stay in config

    // The secret lives, encrypted, in secrets.json — which is gitignored.
    expect(rawSecrets().s3a.s3Secret.startsWith('enc:v1:')).toBe(true);
    expect(fs.readFileSync(secretsFile(), 'utf-8')).not.toContain('super-secret');
    expect(fs.readFileSync(gitignoreFile(), 'utf-8')).toMatch(/^secrets\.json$/m);

    const wire = getPublishTargets(root)[0] as S3PublishTarget;
    expect(wire.secretAccessKey).toBeUndefined();
    expect(wire.hasSecret).toBe(true);
  });

  it('decrypts the secret only for the transport', () => {
    upsertPublishTarget(root, s3);
    expect(getS3Credentials(root, 's3a')).toEqual({ accessKeyId: 'AKIA', secretAccessKey: 'super-secret' });
  });

  it('upsert secret is tri-state: omitted keeps, "" clears', () => {
    upsertPublishTarget(root, s3);
    // Re-save WITHOUT a secret (e.g. edited the region) → existing secret preserved.
    upsertPublishTarget(root, { ...s3, secretAccessKey: undefined, region: 'us-east-1' });
    expect(getS3Credentials(root, 's3a').secretAccessKey).toBe('super-secret');
    expect((getPublishTargets(root)[0] as S3PublishTarget).region).toBe('us-east-1');
    // Explicit '' clears it.
    upsertPublishTarget(root, { ...s3, secretAccessKey: '' });
    expect(getS3Credentials(root, 's3a').secretAccessKey).toBeUndefined();
    expect((getPublishTargets(root)[0] as S3PublishTarget).hasSecret).toBe(false);
  });

  it('removing one target preserves another target\'s encrypted secret', () => {
    const git: GitPublishTarget = { id: 'g', label: 'G', exporter: 'static-site', gitRemote: 'https://x', gitBranch: 'gh-pages' };
    upsertPublishTarget(root, s3);
    upsertPublishTarget(root, git);
    removePublishTarget(root, 'g');
    expect(getS3Credentials(root, 's3a').secretAccessKey).toBe('super-secret'); // survived
  });

  it('leaves git targets without a token unchanged, hasToken false', () => {
    const git: GitPublishTarget = { id: 'g', label: 'G', exporter: 'static-site', gitRemote: 'https://x', gitBranch: 'gh-pages' };
    upsertPublishTarget(root, git);
    expect(getPublishTargets(root)[0]).toEqual({ ...git, hasToken: false });
    expect(getS3Credentials(root, 'g')).toEqual({});
    expect(getGitCredentials(root, 'g')).toEqual({});
  });
});

describe('Git target token (#1508)', () => {
  const git: GitPublishTarget = {
    id: 'g', label: 'G', exporter: 'static-site', gitRemote: 'https://github.com/me/site', gitBranch: 'gh-pages',
    githubToken: 'ghp_secret',
  };

  it('keeps the token out of config.json — encrypted in the gitignored secrets.json', () => {
    upsertPublishTarget(root, git);
    const onDisk = rawTargets()[0];
    expect(onDisk.githubToken).toBeUndefined();
    expect(onDisk.githubTokenEnc).toBeUndefined();
    expect(fs.readFileSync(configFile(), 'utf-8')).not.toContain('ghp_secret');

    expect(rawSecrets().g.githubToken.startsWith('enc:v1:')).toBe(true);
    expect(fs.readFileSync(gitignoreFile(), 'utf-8')).toMatch(/^secrets\.json$/m);

    const wire = getPublishTargets(root)[0] as GitPublishTarget;
    expect(wire.githubToken).toBeUndefined();
    expect(wire.hasToken).toBe(true);
    expect(wire.gitRemote).toBe('https://github.com/me/site');
  });

  it('decrypts the token only for the push', () => {
    upsertPublishTarget(root, git);
    expect(getGitCredentials(root, 'g')).toEqual({ token: 'ghp_secret' });
  });

  it('token is tri-state: omitted keeps, "" clears', () => {
    upsertPublishTarget(root, git);
    upsertPublishTarget(root, { ...git, githubToken: undefined, gitBranch: 'main' });
    expect(getGitCredentials(root, 'g').token).toBe('ghp_secret');
    expect((getPublishTargets(root)[0] as GitPublishTarget).gitBranch).toBe('main');
    upsertPublishTarget(root, { ...git, githubToken: '' });
    expect(getGitCredentials(root, 'g').token).toBeUndefined();
    expect((getPublishTargets(root)[0] as GitPublishTarget).hasToken).toBe(false);
  });
});

describe('migration: legacy inline secrets in config.json move to secrets.json', () => {
  it('relocates *Enc out of config.json on first read', () => {
    // Simulate a pre-split config.json with the secret inline (as the S3/GitHub
    // PRs originally wrote it).
    fs.mkdirSync(path.join(root, '.minerva'), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify({
      publish: { targets: [
        { id: 's3a', kind: 's3', label: 'S', exporter: 'static-site', bucket: 'b', accessKeyId: 'AKIA', secretAccessKeyEnc: 'enc:v1:legacy-s3' },
        { id: 'g', label: 'G', exporter: 'static-site', gitRemote: 'https://x', gitBranch: 'gh-pages', githubTokenEnc: 'enc:v1:legacy-gh' },
      ] },
    }));

    // Any read triggers the one-time migration.
    getPublishTargets(root);

    // config.json no longer carries the ciphertext…
    const cfg = fs.readFileSync(configFile(), 'utf-8');
    expect(cfg).not.toContain('secretAccessKeyEnc');
    expect(cfg).not.toContain('githubTokenEnc');
    // …it's in the gitignored secrets.json instead.
    expect(rawSecrets().s3a.s3Secret).toBe('enc:v1:legacy-s3');
    expect(rawSecrets().g.githubToken).toBe('enc:v1:legacy-gh');
    expect(fs.readFileSync(gitignoreFile(), 'utf-8')).toMatch(/^secrets\.json$/m);
    // Non-secret fields survive; hasSecret/hasToken reflect the relocated secrets.
    expect((getPublishTargets(root)[0] as S3PublishTarget).hasSecret).toBe(true);
    expect((getPublishTargets(root)[1] as GitPublishTarget).hasToken).toBe(true);
  });
});
