/**
 * `docs/extension-points.md`, rendered from the catalog (#2620) — so the page
 * a person reads, the graph an agent queries (#2618) and the tools it calls
 * (#2619) all come from `points.ts` and can't disagree.
 *
 * `tests/shared/extensions/doc.test.ts` compares the committed page with this
 * output; after changing the catalog, regenerate with
 * `pnpm test tests/shared/extensions/doc.test.ts -u`.
 */
import { EXTENSION_POINTS, RUNGS, RUNG_DESCRIPTIONS, type ExtensionPoint, type LoadPath } from './points';

const POINTS = EXTENSION_POINTS as readonly ExtensionPoint[];

const LOAD_PATHS: Record<LoadPath, string> = {
  hot: 'at once, or on its next read',
  'reload-command': 'after an explicit reload',
  restart: 'after restarting the app',
  rebuild: 'only in a rebuilt app',
};

/** A repo path as a link from `docs/`. */
const link = (repoPath: string) => {
  const rel = repoPath.startsWith('docs/') ? repoPath.slice('docs/'.length) : `../${repoPath}`;
  return `[\`${repoPath}\`](${rel})`;
};

/** Prose for markdown: `<thoughtbase>` would otherwise vanish as an HTML tag. */
const text = (s: string) => s.replace(/</g, '&lt;');

function section(p: ExtensionPoint): string {
  const lines = [`## \`${p.id}\` — ${p.label}`, '', text(p.description), ''];
  lines.push(`- **Rung:** ${p.rung}`);
  lines.push(`- **Picked up:** ${LOAD_PATHS[p.loadPath]} (\`${p.loadPath}\`)`);
  lines.push(`- **Contributions from:** ${p.sources.join(', ')}`);
  if (p.location) lines.push(`- **Goes in:** ${text(p.location)}`);
  const at = `${link(p.contract.at.file)}${p.contract.at.symbol ? ` (\`${p.contract.at.symbol}\`)` : ''}`;
  if (p.contract.kind === 'parser') {
    lines.push(`- **Contract:** ${text(p.contract.format)}, checked by ${at}`);
  } else {
    lines.push(`- **Contract:** none yet — built-ins register in ${at}; nothing outside the source can add one until plugins load (#2631)`);
  }
  if (p.story !== undefined) lines.push(`- **Made a registry by:** #${p.story}`);
  if (p.docs) lines.push(`- **Docs:** ${link(p.docs)}`);
  if (p.example) lines.push(`- **Example:** ${link(p.example)}`);
  if (p.harness) lines.push(`- **Test:** ${link(p.harness)}`);
  return lines.join('\n');
}

export function renderExtensionPointsDoc(): string {
  const byRung = RUNGS.map((r) => ({ rung: r, points: POINTS.filter((p) => p.rung === r) }));
  const out = [
    '# Extension points',
    '',
    '<!-- Generated from src/shared/extensions/points.ts by src/shared/extensions/doc.ts — do not edit.',
    '     Change the catalog, then: pnpm test tests/shared/extensions/doc.test.ts -u -->',
    '',
    'Every seam something can be added to Minerva through: what a contribution looks like, which rung',
    'of the ladder it sits on, how it is picked up, and where its docs, an example and its test live.',
    'The same catalog is in the knowledge graph (`minerva:ExtensionPoint`, with what is installed in',
    'each as `minerva:Contribution`) and behind the `list_extension_points` / `describe_extension_point`',
    'tools, in the app and over `minerva mcp`.',
    '',
    '## The ladder',
    '',
    'Reach for the lowest rung that does the job — declarative before code.',
    '',
    ...RUNGS.map((r, i) => `${i + 1}. **${r}** — ${RUNG_DESCRIPTIONS[r]}`),
    '',
    '## At a glance',
    '',
    '| Extension point | Rung | Picked up | From |',
    '|---|---|---|---|',
    ...byRung.flatMap(({ points }) => points.map((p) =>
      `| [${p.label}](#${p.id}--${slug(p.label)}) | ${p.rung} | ${p.loadPath} | ${p.sources.join(', ')} |`)),
    '',
    ...byRung.flatMap(({ points }) => points.flatMap((p) => [section(p), ''])),
  ];
  return out.join('\n');
}

/** GitHub's heading anchor for the label part of a section heading. */
function slug(label: string): string {
  return label.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
}
