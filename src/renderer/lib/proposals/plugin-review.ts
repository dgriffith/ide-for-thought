/**
 * What the Proposals panel shows for a plugin an agent wrote (#2890): the
 * manifest, what it can do in words, its MCP servers, and every file — for a
 * change to an installed plugin, what it can now do that it couldn't, and a
 * line diff of each file against the installed one. Read from the payload
 * main filed; the panel shows it as text.
 */
import { describeCapabilities, isPluginCapability, PLUGIN_CAPABILITIES, type PluginCapability } from '../../../shared/plugins/capabilities';
import { diffLines } from '../history/line-diff';
import { logger } from '../../../shared/logger';

export interface PluginFilesPayload {
  kind: 'plugin-install' | 'plugin-update';
  id: string;
  name: string;
  files: { path: string; content: string }[];
  before?: { path: string; content: string }[];
}

interface ManifestView {
  name: string;
  version: string;
  description: string;
  capabilities: PluginCapability[];
  hasCode: boolean;
  servers: string[];
}

function manifestOf(files: readonly { path: string; content: string }[]): ManifestView | null {
  const text = files.find((f) => f.path === 'plugin.json')?.content;
  if (!text) return null;
  try {
    const m = JSON.parse(text) as Record<string, unknown>;
    const code = (m.code && typeof m.code === 'object' ? m.code : null) as { capabilities?: unknown } | null;
    const caps = Array.isArray(code?.capabilities) ? code.capabilities.filter((c): c is PluginCapability => typeof c === 'string' && isPluginCapability(c)) : [];
    const servers = m.mcpServers && typeof m.mcpServers === 'object'
      ? Object.entries(m.mcpServers as Record<string, { command?: unknown; args?: unknown; url?: unknown }>).map(([key, s]) =>
        `${key}: ${typeof s?.url === 'string' ? s.url : [s?.command, ...(Array.isArray(s?.args) ? (s.args as unknown[]) : [])].filter((x) => typeof x === 'string').join(' ')}`)
      : [];
    return {
      name: typeof m.name === 'string' ? m.name : '?',
      version: typeof m.version === 'string' ? m.version : '?',
      description: typeof m.description === 'string' ? m.description : '',
      capabilities: caps,
      hasCode: code !== null,
      servers,
    };
  } catch (err) {
    // Checked when it was drafted or installed, so this is a damaged proposal: say so in the review.
    logger('proposal').warn('a plugin proposal\'s plugin.json didn\'t parse:', err);
    return null;
  }
}

/** One line for the payload row. */
export function pluginPayloadSummary(p: PluginFilesPayload): string {
  if (p.kind === 'plugin-install') return `install ${p.name} (${p.id}), ${p.files.length} file${p.files.length === 1 ? '' : 's'}`;
  const before = new Map((p.before ?? []).map((f) => [f.path, f.content]));
  const after = new Map(p.files.map((f) => [f.path, f.content]));
  const changed = p.files.filter((f) => before.has(f.path) && before.get(f.path) !== f.content).length;
  const added = p.files.filter((f) => !before.has(f.path)).length;
  const removed = [...before.keys()].filter((k) => !after.has(k)).length;
  return `change ${p.name} (${p.id}): ${[changed && `${changed} changed`, added && `${added} added`, removed && `${removed} removed`].filter(Boolean).join(', ') || 'no file changes'}`;
}

function describe(m: ManifestView | null): string[] {
  if (!m) return ['(no readable plugin.json)'];
  return [
    `${m.name} ${m.version}: ${m.description}`,
    m.hasCode ? (describeCapabilities(m.capabilities) || 'It runs code, and asks for no capabilities.') : 'It runs no code.',
    ...(m.hasCode ? ['Approving it, Minerva then asks you to allow its code.'] : []),
    ...m.servers.map((s) => `MCP server ${s} (off until you switch it on)`),
  ];
}

/** The whole review: the manifest in words, then every file or its diff. */
export function pluginPayloadReview(p: PluginFilesPayload): string {
  const now = manifestOf(p.files);
  if (p.kind === 'plugin-install') {
    return [...describe(now), '', ...p.files.flatMap((f) => [`── ${f.path} ──`, f.content.replace(/\n$/, ''), ''])].join('\n');
  }
  const was = manifestOf(p.before ?? []);
  const wasCaps = was?.capabilities ?? [];
  const nowCaps = now?.capabilities ?? [];
  const gained = nowCaps.filter((c) => !wasCaps.includes(c));
  const lost = wasCaps.filter((c) => !nowCaps.includes(c));
  const lines = [
    ...describe(now),
    ...(was && now && was.version !== now.version ? [`Version ${was.version} → ${now.version}.`] : []),
    ...(gained.length > 0 ? [`Now it can also: ${gained.map((c) => PLUGIN_CAPABILITIES[c].describes).join('; ')}.`] : []),
    ...(lost.length > 0 ? [`It no longer asks to: ${lost.map((c) => PLUGIN_CAPABILITIES[c].describes).join('; ')}.`] : []),
    ...(was && !was.hasCode && now?.hasCode ? ['It didn\'t run code before; now it does.'] : []),
    '',
  ];
  const before = new Map((p.before ?? []).map((f) => [f.path, f.content]));
  const after = new Map(p.files.map((f) => [f.path, f.content]));
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(path);
    const b = after.get(path);
    if (a === b) continue;
    lines.push(`── ${path} ${a === undefined ? '(new)' : b === undefined ? '(removed)' : '(changed)'} ──`);
    for (const d of diffLines(a ?? '', b ?? '')) lines.push(`${d.type === 'add' ? '+' : d.type === 'remove' ? '-' : ' '} ${d.text}`);
    lines.push('');
  }
  return lines.join('\n');
}
