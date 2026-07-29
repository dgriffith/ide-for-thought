/**
 * The publish-transport seam (#1444).
 *
 * Rendering (the exporter registry) turns notes into a file tree; a *transport*
 * ships that tree somewhere. Git was the only transport and was hardwired into
 * `publishToGit`; this interface makes "ship the artifact" pluggable so a second
 * transport (S3 / S3-compatible) is a new implementation, not a fork of the
 * publish flow — the same shape the exporter registry and the `LLMProvider`
 * seam already use.
 *
 * Stated direction: `docs/vision/publication.md` → publication should be
 * output-neutral: produce the artifact, let the user host it wherever.
 */
import type { PublishTarget } from '../../project-config';
import type { PublishOptions, PublishResult } from '../publish-to-git';

export type PublishTargetKind = 'git' | 's3';

export interface PublishTransport {
  /** The target kind this transport handles. */
  readonly kind: PublishTargetKind;
  /**
   * Ship a configured target's exported artifact. Resolves the exporter output
   * itself (via `runExport`) so the caller stays transport-neutral. `dryRun`
   * previews without shipping where the transport can.
   */
  publish(rootPath: string, target: PublishTarget, opts: PublishOptions): Promise<PublishResult>;
}
