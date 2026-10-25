/**
 * What Minerva asks before a plugin's code runs (#2833), natively, in main:
 * at install, and again whenever the plugin's files change — an upgrade or
 * an edit in place — since its approval is pinned to their hash
 * (`code-hash.ts`). A renderer can't draw or answer it.
 *
 * Pure: the question's words, from the manifest and what was approved before.
 */
import { describeCapabilities, PLUGIN_CAPABILITIES, type PluginCapability } from '../../shared/plugins/capabilities';
import type { PluginManifest } from '../../shared/plugins/format';
import type { NativeConfirmRequest } from '../native-confirm';

const SANDBOX = 'Its code runs sandboxed, inside Minerva: it can\'t reach the network, your files, or anything you haven\'t shown it.';

/** The question for `manifest`; `before` is what was approved, when it's a change. */
export function codeApprovalQuestion(manifest: PluginManifest, before?: { capabilities: readonly PluginCapability[] }): NativeConfirmRequest {
  const caps = manifest.code?.capabilities ?? [];
  const by = manifest.author ? ` by ${manifest.author}` : '';
  const what = `${manifest.name} ${manifest.version}${by}: ${manifest.description}`;
  const can = describeCapabilities(caps) || 'It asks for no capabilities.';
  if (!before) {
    return { message: `Install ${manifest.name}? It runs code inside Minerva.`, detail: `${what}\n\n${can}\n\n${SANDBOX}`, confirmLabel: 'Install' };
  }
  const added = caps.filter((c) => !before.capabilities.includes(c));
  const removed = before.capabilities.filter((c) => !caps.includes(c));
  const lines = [
    ...(added.length > 0 ? [`Now it can also: ${added.map((c) => PLUGIN_CAPABILITIES[c].describes).join('; ')}.`] : []),
    ...(removed.length > 0 ? [`It no longer asks to: ${removed.map((c) => PLUGIN_CAPABILITIES[c].describes).join('; ')}.`] : []),
  ];
  const change = lines.length > 0 ? lines.join('\n') : 'It asks for the same capabilities as before; its files changed.';
  return {
    message: `${manifest.name} changed since you allowed it. Allow it again?`,
    detail: `${what}\n\n${change}\n\n${can}\n\n${SANDBOX} It stays off until you allow it.`,
    confirmLabel: 'Allow',
  };
}
