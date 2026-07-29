/**
 * S3 publish transport (#1444).
 *
 * Pure helpers (content type, prefix, key) are tested directly. `publishToS3`
 * runs through a mocked `runExport` (writes a small tree into the temp
 * workspace) + an INJECTED fake S3Client, so upload → key mapping, content
 * types, orphan deletion, the added/modified/deleted change list, and dry-run
 * (no writes) are exercised without a bucket or a real project.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';

const h = vi.hoisted(() => ({ runExport: vi.fn() }));
vi.mock('../../../src/main/publish/run-export', () => ({ runExport: h.runExport }));

// The real @aws-sdk/client-s3 mis-resolves to a broken browser build under the
// runner's browser condition. We inject a fake client anyway, so a lightweight
// mock (command classes whose names the fake dispatches on) is all we need.
vi.mock('@aws-sdk/client-s3', () => {
  class Cmd { input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
  return {
    S3Client: class { send = vi.fn(); },
    PutObjectCommand: class extends Cmd {},
    ListObjectsV2Command: class extends Cmd {},
    DeleteObjectsCommand: class extends Cmd {},
    HeadBucketCommand: class extends Cmd {},
  };
});

import {
  publishToS3,
  contentTypeFor,
  normalizePrefix,
  objectKey,
} from '../../../src/main/publish/publish-to-s3';
import type { S3PublishTarget } from '../../../src/main/project-config';

function fakeClient(existingKeys: string[]) {
  const puts: { Key: string; ContentType: string }[] = [];
  const deletes: string[] = [];
  const send = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    switch (cmd.constructor.name) {
      case 'ListObjectsV2Command':
        return { Contents: existingKeys.map((Key) => ({ Key })), IsTruncated: false };
      case 'PutObjectCommand':
        puts.push({ Key: cmd.input.Key as string, ContentType: cmd.input.ContentType as string });
        return {};
      case 'DeleteObjectsCommand':
        for (const o of (cmd.input.Delete as { Objects: { Key: string }[] }).Objects) deletes.push(o.Key);
        return {};
      default:
        return {};
    }
  });
  return { client: { send } as unknown as S3Client, puts, deletes };
}

const target: S3PublishTarget = { id: 't', kind: 's3', label: 'T', exporter: 'static-site', bucket: 'my-bucket', subdir: 'site' };

beforeEach(() => {
  vi.clearAllMocks();
  h.runExport.mockImplementation(async (_root: string, args: { outputDir: string }) => {
    fs.mkdirSync(path.join(args.outputDir, 'css'), { recursive: true });
    fs.writeFileSync(path.join(args.outputDir, 'index.html'), '<html>');
    fs.writeFileSync(path.join(args.outputDir, 'css', 'style.css'), 'body{}');
    return { filesWritten: 2, summary: '', outputDir: args.outputDir, writtenPaths: [] };
  });
});

describe('pure helpers', () => {
  it('contentTypeFor maps by extension, defaulting to octet-stream', () => {
    expect(contentTypeFor('a/b.html')).toMatch(/text\/html/);
    expect(contentTypeFor('x.css')).toMatch(/text\/css/);
    expect(contentTypeFor('img.png')).toBe('image/png');
    expect(contentTypeFor('data.bin')).toBe('application/octet-stream');
  });
  it('normalizePrefix strips slashes; objectKey joins under the prefix', () => {
    expect(normalizePrefix('/site/')).toBe('site');
    expect(normalizePrefix(undefined)).toBe('');
    expect(objectKey('site', 'a/b.html')).toBe('site/a/b.html');
    expect(objectKey('', 'x.html')).toBe('x.html');
  });
});

describe('publishToS3', () => {
  it('uploads the tree under the prefix with content types, deletes orphans', async () => {
    const { client, puts, deletes } = fakeClient(['site/index.html', 'site/old.html']);
    const res = await publishToS3('/root', target, {}, {}, { client });

    expect(new Set(puts.map((p) => p.Key))).toEqual(new Set(['site/index.html', 'site/css/style.css']));
    expect(puts.find((p) => p.Key === 'site/index.html')!.ContentType).toMatch(/text\/html/);
    expect(deletes).toEqual(['site/old.html']); // orphan removed (mirror semantics)

    const byPath = Object.fromEntries(res.changes.map((c) => [c.path, c.status]));
    expect(byPath['site/index.html']).toBe('modified'); // existed
    expect(byPath['site/css/style.css']).toBe('added'); // new
    expect(byPath['site/old.html']).toBe('deleted');
    expect(res.committed && res.pushed).toBe(true);
  });

  it('dry run reports changes but writes nothing', async () => {
    const { client, puts, deletes } = fakeClient(['site/old.html']);
    const res = await publishToS3('/root', target, {}, { dryRun: true }, { client });
    expect(puts).toEqual([]);
    expect(deletes).toEqual([]);
    expect(res.dryRun).toBe(true);
    expect(res.changes.some((c) => c.status === 'deleted' && c.path === 'site/old.html')).toBe(true);
    expect(res.committed).toBe(false);
  });
});
