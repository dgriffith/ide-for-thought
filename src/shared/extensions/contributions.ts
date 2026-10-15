/**
 * What is installed in each extension point (#2618): one record per
 * contribution, gathered by the main process's composition root and
 * materialised into the graph next to the points themselves.
 */
import type { ContributionSource, ExtensionPointId } from './points';

export interface Contribution {
  point: ExtensionPointId;
  /** Unique within its point. */
  id: string;
  label: string;
  source: ContributionSource;
  /** Where it lives, when it's a file. */
  location?: string;
  /** The plugin that supplied it, when `source` is `'plugin'` (#2633). */
  plugin?: { id: string; name: string; version: string };
}
