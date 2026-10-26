/**
 * Human-readable attribution for a proposal's `proposedBy` stamp (#1151, epic
 * #1145 — Substrate: provenance for the fleet).
 *
 * Every proposal carries a free-form `thought:proposedBy` string. Minerva's own
 * AI writes `llm:*` (`llm:conversation:<id>`, `llm:auto-tag`, …); external fleet
 * agents write `mcp:<client>` (an MCP client, named from its initialize
 * handshake) or `cli` (the headless CLI / scripts). This turns that convention
 * into a legible label plus an internal-vs-external distinction, so the review
 * queue and audit views can show *who* contributed *what* — the whole point of
 * "the graph is the audit log of the entourage's contributions."
 */
export type ProposerKind = 'internal' | 'external' | 'cli' | 'plugin' | 'unknown';

export interface ProposerInfo {
  /** The raw `proposedBy` stamp, verbatim. */
  raw: string;
  kind: ProposerKind;
  /** The specific agent/source, e.g. 'claude-code', 'Minerva AI', 'CLI'. */
  agent: string;
  /** Short label for display. */
  label: string;
  /** True for anything outside Minerva's own AI — i.e. a fleet member. */
  external: boolean;
}

const MCP_PREFIX = 'mcp:';
const LLM_PREFIX = 'llm:';
const PLUGIN_PREFIX = 'plugin:';

export function describeProposer(proposedBy: string | null | undefined): ProposerInfo {
  const raw = proposedBy ?? '';

  // External MCP client — `mcp:<client-name>`, the name from its initialize
  // handshake (e.g. `mcp:claude-code`, `mcp:browser-agent`).
  if (raw.startsWith(MCP_PREFIX)) {
    const agent = raw.slice(MCP_PREFIX.length).trim() || 'unknown';
    return { raw, kind: 'external', agent, label: agent, external: true };
  }

  // The headless CLI / scripts.
  if (raw === 'cli' || raw.startsWith('cli:')) {
    return { raw, kind: 'cli', agent: 'CLI', label: 'CLI', external: true };
  }

  // A plugin's model request (#2858) — `plugin:<id>@<version>+llm:<model>`:
  // the plugin asked, the model wrote it. Not Minerva's own AI.
  if (raw.startsWith(PLUGIN_PREFIX)) {
    const m = /^plugin:([^@+\s]+)(?:@[^+\s]*)?(?:\+llm:(\S+))?/.exec(raw);
    const agent = m?.[1] ?? 'unknown';
    const label = m?.[2] ? `${agent} (plugin, ${m[2]})` : `${agent} (plugin)`;
    return { raw, kind: 'plugin', agent, label, external: true };
  }

  // Minerva's built-in AI — `llm:conversation:<id>`, `llm:auto-tag`, …
  if (raw.startsWith(LLM_PREFIX)) {
    return { raw, kind: 'internal', agent: 'Minerva AI', label: 'Minerva AI', external: false };
  }

  // Anything else (an empty stamp, a test harness like `e2e`): show as-is, and
  // don't claim it's a fleet agent.
  const shown = raw || 'unknown';
  return { raw, kind: 'unknown', agent: shown, label: shown, external: false };
}
