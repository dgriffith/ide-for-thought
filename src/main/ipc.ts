import { registerNotebase } from './ipc/register-notebase';
import { registerLinks } from './ipc/register-links';
import { registerQueries } from './ipc/register-queries';
import { registerGraph } from './ipc/register-graph';
import { registerTags } from './ipc/register-tags';
import { registerTemplates } from './ipc/register-templates';
import { registerShell } from './ipc/register-shell';
import { registerGit } from './ipc/register-git';
import { registerSites } from './ipc/register-sites';
import { registerBibliography } from './ipc/register-bibliography';
import { registerTools } from './ipc/register-tools';
import { registerTypes } from './ipc/register-types';
import { registerViews } from './ipc/register-views';
import { registerRefactor } from './ipc/register-refactor';
import { registerSources } from './ipc/register-sources';
import { registerCompute } from './ipc/register-compute';
import { registerPublish } from './ipc/register-publish';
import { registerConversation } from './ipc/register-conversation';
import { registerConversationDrafts } from './ipc/register-conversation-drafts';
import { registerProposals } from './ipc/register-proposals';
import { registerBookmarks } from './ipc/register-bookmarks';
import { registerHistory } from './ipc/register-history';
import { registerClipper } from './ipc/register-clipper';
import { registerApp } from './ipc/register-app';
import { onProposalsChanged } from './llm/proposal-events';
import { onInspectionsChanged } from './graph/inspection-events';
import { onHistoryChanged } from './history';
import { broadcastProposalsChanged, broadcastInspectionsChanged, broadcastHistoryChanged } from './ipc/helpers';
import { updateDockBadge } from './project-context';

export function registerIpcHandlers(): void {
  // Turn Electron-free proposal-lifecycle events (fired by the shared approval
  // engine, in-app or via the substrate server) into a renderer broadcast (#1524)
  // plus a dock-badge refresh (#1528).
  onProposalsChanged((rootPath) => {
    broadcastProposalsChanged(rootPath);
    void updateDockBadge();
  });

  // Same shape for inspections (#1795): the checks re-run a beat after any
  // graph write, so the panel is told rather than left on a stale list.
  onInspectionsChanged((rootPath) => {
    broadcastInspectionsChanged(rootPath);
  });

  // And for note history (#1834): a revision can be captured by any write path,
  // including ones the renderer never asked for (an applied proposal, a
  // bibliography rebuild), so the panel is told instead of polling for it.
  onHistoryChanged((rootPath, relPath) => {
    broadcastHistoryChanged(rootPath, relPath);
  });

  registerNotebase();
  registerLinks();
  registerQueries();
  registerGraph();
  registerTags();
  registerTemplates();
  registerShell();
  registerGit();
  registerSites();
  registerBibliography();
  registerTools();
  registerTypes();
  registerViews();
  registerRefactor();
  registerSources();
  registerCompute();
  registerPublish();
  registerProposals();
  registerConversation();
  registerConversationDrafts();
  registerBookmarks();
  registerHistory();
  registerClipper();
  registerApp();
}
