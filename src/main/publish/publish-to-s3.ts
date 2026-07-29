/**
 * "Publish → S3 / S3-compatible object storage" transport (#1444).
 *
 * Mirror of `publish-to-git.ts`: run the configured exporter into a temp dir,
 * then upload the tree. One build serves Amazon S3 and every S3-compatible
 * provider (Cloudflare R2, Backblaze B2, DigitalOcean Spaces, Wasabi, MinIO) via
 * a custom `endpoint`. Credentials are optional — when absent the AWS SDK's
 * default chain (`~/.aws`, env) applies, which real-AWS users may prefer.
 *
 * Mirroring semantics match git's `clearWorkTree`: objects under the prefix that
 * the new export doesn't produce are deleted (delete-orphans), so the published
 * site never accumulates stale files. Preview is coarse (which files, by
 * existence — no content diff; the etag/hash manifest compare is a follow-up,
 * per #1444 decision #2): a dry run reports what *would* upload/delete without
 * touching the bucket.
 *
 * `@aws-sdk/client-s3` is a Node/main dependency — no renderer bundling concern.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Type-only: the SDK values are dynamically imported inside the functions below
// so that merely importing this module (via the publish barrel / transport
// registry) never loads @aws-sdk — it's a heavy node-only dep that mis-resolves
// under the test runner's browser condition, and lazy-loading keeps it out of
// unrelated import graphs. It loads when an S3 publish actually runs.
import type { S3Client } from '@aws-sdk/client-s3';
import type { S3PublishTarget } from '../project-config';
import type { ConnectionCheckResult } from '../../shared/tools/types';
import { toConnectionResult } from '../llm/connection-error';
import { runExport } from './run-export';
import type { PublishOptions, PublishResult } from './publish-to-git';
import type { PublishChange } from '../git/publish-git';

export interface S3Credentials {
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** Content type by file extension; unknown → application/octet-stream. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export function contentTypeFor(key: string): string {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
}

/** Normalise a prefix: strip surrounding slashes, collapse `\`. '' = bucket root. */
export function normalizePrefix(prefix: string | undefined): string {
  return (prefix ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Object key for a POSIX-relative export path under the target's prefix. */
export function objectKey(prefix: string, relPath: string): string {
  const rel = relPath.split(path.sep).join('/');
  return prefix ? `${prefix}/${rel}` : rel;
}

/** Recursively collect files under `dir` as `{ relPath, absPath }`. */
function walkFiles(dir: string): { relPath: string; absPath: string }[] {
  const out: { relPath: string; absPath: string }[] = [];
  const walk = (cur: string) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push({ relPath: path.relative(dir, abs), absPath: abs });
    }
  };
  walk(dir);
  return out;
}

export async function buildS3Client(target: S3PublishTarget, creds: S3Credentials): Promise<S3Client> {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const hasCreds = !!(creds.accessKeyId && creds.secretAccessKey);
  return new S3Client({
    region: target.region || 'us-east-1',
    // A custom endpoint means an S3-compatible provider; path-style addressing
    // is the portable choice (MinIO, and buckets with dots).
    ...(target.endpoint ? { endpoint: target.endpoint, forcePathStyle: true } : {}),
    // Omit `credentials` to fall back to the SDK's default chain (real AWS).
    ...(hasCreds ? { credentials: { accessKeyId: creds.accessKeyId!, secretAccessKey: creds.secretAccessKey! } } : {}),
  });
}

/** List every object key currently under `prefix`. */
async function listExistingKeys(client: S3Client, bucket: string, prefix: string): Promise<Set<string>> {
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const keys = new Set<string>();
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ...(prefix ? { Prefix: `${prefix}/` } : {}),
      ...(token ? { ContinuationToken: token } : {}),
    }));
    for (const o of res.Contents ?? []) if (o.Key) keys.add(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export interface PublishToS3Deps {
  /** Injectable client for tests; production builds one from the target + creds. */
  client?: S3Client;
}

export async function publishToS3(
  rootPath: string,
  target: S3PublishTarget,
  creds: S3Credentials,
  opts: PublishOptions = {},
  deps: PublishToS3Deps = {},
): Promise<PublishResult> {
  const dryRun = opts.dryRun ?? false;
  const prefix = normalizePrefix(target.subdir);
  const { PutObjectCommand, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
  const client = deps.client ?? (await buildS3Client(target, creds));

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-s3-publish-'));
  try {
    await runExport(rootPath, { exporterId: target.exporter, input: { kind: 'project' }, outputDir: workspace });
    const files = walkFiles(workspace);
    const newKeys = new Map(files.map((f) => [objectKey(prefix, f.relPath), f.absPath]));

    const existing = await listExistingKeys(client, target.bucket, prefix);
    const orphans = [...existing].filter((k) => !newKeys.has(k));

    const changes: PublishChange[] = [
      ...[...newKeys.keys()].map((key): PublishChange => ({ path: key, status: existing.has(key) ? 'modified' : 'added' })),
      ...orphans.map((key): PublishChange => ({ path: key, status: 'deleted' })),
    ];

    const base: PublishResult = {
      targetId: target.id,
      dryRun,
      branch: '',
      branchCreated: false,
      changes,
      committed: false,
      pushed: false,
    };
    if (dryRun) return base;

    for (const [key, absPath] of newKeys) {
      await client.send(new PutObjectCommand({
        Bucket: target.bucket,
        Key: key,
        Body: fs.readFileSync(absPath),
        ContentType: contentTypeFor(key),
      }));
    }
    // Delete orphans in batches of 1000 (the API limit).
    for (let i = 0; i < orphans.length; i += 1000) {
      await client.send(new DeleteObjectsCommand({
        Bucket: target.bucket,
        Delete: { Objects: orphans.slice(i, i + 1000).map((Key) => ({ Key })) },
      }));
    }

    const shipped = changes.length > 0;
    return { ...base, committed: shipped, pushed: shipped };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/** Validate S3 credentials + endpoint against the bucket with a token-free
 *  HeadBucket — powers the settings "Check connection" button (#1444). */
export async function checkS3Connection(
  target: S3PublishTarget,
  creds: S3Credentials,
  deps: PublishToS3Deps = {},
): Promise<ConnectionCheckResult> {
  const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
  const client = deps.client ?? (await buildS3Client(target, creds));
  return toConnectionResult(() => client.send(new HeadBucketCommand({ Bucket: target.bucket })));
}
