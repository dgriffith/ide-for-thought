/**
 * The S3 publish transport (#1444) — second `PublishTransport`. Fetches the
 * target's decrypted credentials (main-only) and delegates to `publishToS3`.
 */
import { getS3Credentials } from '../../project-config';
import { publishToS3 } from '../publish-to-s3';
import type { PublishTransport } from './types';

export const s3Transport: PublishTransport = {
  kind: 's3',
  publish: (rootPath, target, opts) => {
    if (target.kind !== 's3') throw new Error('s3Transport received a non-s3 target.');
    return publishToS3(rootPath, target, getS3Credentials(rootPath, target.id), opts);
  },
};
