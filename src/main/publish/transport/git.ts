/**
 * The git publish transport (#1444) — the first `PublishTransport`. A thin
 * adapter over the existing `publishToGit` orchestration, which keeps its own
 * signature/tests unchanged; the transport just registers it behind the seam.
 */
import { publishToGit } from '../publish-to-git';
import type { PublishTransport } from './types';

export const gitTransport: PublishTransport = {
  kind: 'git',
  publish: (rootPath, target, opts) => publishToGit(rootPath, target.id, opts),
};
