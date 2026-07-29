/**
 * Publish-transport seam + dispatcher (#1444).
 *
 * The dispatcher resolves a configured target and routes it to the transport
 * registered for its `kind` (defaulting absent → git). Git is registered by
 * default; a fake transport exercises dispatch + the target/kind guards without
 * touching the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ getPublishTarget: vi.fn() }));
vi.mock('../../../src/main/project-config', () => ({ getPublishTarget: h.getPublishTarget }));

import { publishTarget, getTransport, registerTransport } from '../../../src/main/publish/transport';

beforeEach(() => vi.clearAllMocks());

describe('transport registry', () => {
  it('registers the git + s3 transports by default', () => {
    expect(getTransport('git')?.kind).toBe('git');
    expect(getTransport('s3')?.kind).toBe('s3');
  });
});

describe('publishTarget dispatch', () => {
  it('routes a target to the transport for its kind', async () => {
    const publishFn = vi.fn(async () => ({
      targetId: 'x', dryRun: false, branch: '', branchCreated: false, changes: [], committed: false, pushed: false,
    }));
    registerTransport({ kind: 's3', publish: publishFn });
    const target = { id: 'x', label: 'X', kind: 's3', exporter: 'static-site' };
    h.getPublishTarget.mockReturnValue(target);

    await publishTarget('/root', 'x', { dryRun: true });
    expect(publishFn).toHaveBeenCalledWith('/root', target, { dryRun: true });
  });

  it('throws when the target does not exist', async () => {
    h.getPublishTarget.mockReturnValue(null);
    await expect(publishTarget('/root', 'missing')).rejects.toThrow(/No publish target "missing"/);
  });

  it('throws when no transport is registered for the target kind', async () => {
    h.getPublishTarget.mockReturnValue({ id: 'x', label: 'X', kind: 'nope', exporter: 'static-site' });
    await expect(publishTarget('/root', 'x')).rejects.toThrow(/No publish transport is registered for kind "nope"/);
  });
});
