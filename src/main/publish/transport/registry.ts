/**
 * Publish-transport registry (#1444). The built-in transports (git, S3) are a
 * table keyed by target kind, loaded with the module — internal, not
 * user-pluggable, so there's no `registerBuiltin…()` step to wire into startup.
 */
import type { PublishTransport, PublishTargetKind } from './types';
import { gitTransport } from './git';
import { s3Transport } from './s3';

/**
 * The built-in transport for every kind of target (#2630). Keyed by
 * `PublishTargetKind`, which is derived from the target config types — so a
 * kind of target added there without a transport here doesn't compile.
 */
const BUILTIN_TRANSPORTS: Record<PublishTargetKind, PublishTransport> = {
  git: gitTransport,
  s3: s3Transport,
};

const transports = new Map<PublishTargetKind, PublishTransport>(
  Object.entries(BUILTIN_TRANSPORTS) as Array<[PublishTargetKind, PublishTransport]>,
);

/** Replace a kind's transport (tests stand in a fake). */
export function registerTransport(transport: PublishTransport): void {
  transports.set(transport.kind, transport);
}

export function getTransport(kind: PublishTargetKind): PublishTransport | undefined {
  return transports.get(kind);
}
