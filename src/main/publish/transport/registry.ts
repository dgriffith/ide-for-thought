/**
 * Publish-transport registry (#1444). Built-in transports register at module
 * load — they're internal (git, and S3 next), not user-pluggable, so there's no
 * explicit `registerBuiltin…()` step to wire into startup.
 */
import type { PublishTransport, PublishTargetKind } from './types';
import { gitTransport } from './git';

const transports = new Map<PublishTargetKind, PublishTransport>();

export function registerTransport(transport: PublishTransport): void {
  transports.set(transport.kind, transport);
}

export function getTransport(kind: PublishTargetKind): PublishTransport | undefined {
  return transports.get(kind);
}

registerTransport(gitTransport);
