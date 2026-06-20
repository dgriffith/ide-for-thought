import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

/**
 * A block-id marker is `^id` after one or more spaces, near the end of a line.
 * Same matcher as `unique-block-ids-per-note`; see `note-anchors.ts` for the
 * canonical form.
 */
const BLOCK_ID_RE = /(\s)\^([\w-]+)(?=\s*(?:\r?\n|$))/g;

registerRule({
  id: 'strip-orphaned-block-ids',
  category: 'minerva',
  title: 'Strip orphaned block-ids',
  description:
    'Remove `^block-id` markers that no `[[note#^block-id]]` link anywhere in the thoughtbase points at. Off by default — a block-id you just added but haven’t linked yet counts as orphaned and will be stripped on the next format. Needs thoughtbase context, so it only runs when formatting a saved note or folder, not on paste.',
  defaultConfig: {},
  apply(content, _cfg, cache, ctx) {
    const incoming = ctx?.incomingAnchorLinkCount;
    const notePath = ctx?.notePath;
    // No cross-note context (e.g. paste / a buffer with no project) → can't
    // tell orphans from linked ids, so leave every marker alone.
    if (!incoming || !notePath) return content;
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(BLOCK_ID_RE, (match, _lead: string, id: string) =>
        incoming(notePath, `^${id}`) === 0 ? '' : match,
      ),
    );
  },
});
