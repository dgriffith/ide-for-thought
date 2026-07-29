/**
 * Publish-transport dispatcher (#1444). Resolves a configured target and hands
 * it to the transport for its `kind` — the single branch point a new transport
 * slots into (mirrors the `LLMProvider` factory). Existing targets predate the
 * `kind` field and default to git.
 */
import { getPublishTarget } from '../../project-config';
import type { PublishOptions, PublishResult } from '../publish-to-git';
import { getTransport } from './registry';

export async function publishTarget(
  rootPath: string,
  targetId: string,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const target = getPublishTarget(rootPath, targetId);
  if (!target) throw new Error(`No publish target "${targetId}" is configured for this thoughtbase.`);
  const kind = target.kind ?? 'git';
  const transport = getTransport(kind);
  if (!transport) throw new Error(`No publish transport is registered for kind "${kind}".`);
  return transport.publish(rootPath, target, opts);
}

export { getTransport, registerTransport } from './registry';
export type { PublishTransport, PublishTargetKind } from './types';
