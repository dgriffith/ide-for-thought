/**
 * Wiki-link resolution moved to `shared/` (#778) so the main-side formatter
 * orchestrator can use it too. Re-exported here to keep the renderer's
 * existing import path (`../wiki-link-resolver`) stable.
 */
export {
  flattenNoteFiles,
  resolveWikiLinkTarget,
  canonicalizeWikiLinkTarget,
  type WikiLinkPathStyle,
} from '../../shared/wiki-link-resolver';
