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
import { registerRefactor } from './ipc/register-refactor';
import { registerSources } from './ipc/register-sources';
import { registerCompute } from './ipc/register-compute';
import { registerPublish } from './ipc/register-publish';
import { registerConversation } from './ipc/register-conversation';
import { registerBookmarks } from './ipc/register-bookmarks';
import { registerClipper } from './ipc/register-clipper';
import { registerApp } from './ipc/register-app';
import { onProposalsChanged } from './llm/proposal-events';
import { broadcastProposalsChanged } from './ipc/helpers';
import { updateDockBadge } from './project-context';

export function registerIpcHandlers(): void {
  // Turn Electron-free proposal-lifecycle events (fired by the shared approval
  // engine, in-app or via the substrate server) into a renderer broadcast (#1524)
  // plus a dock-badge refresh (#1528).
  onProposalsChanged((rootPath) => {
    broadcastProposalsChanged(rootPath);
    void updateDockBadge();
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
  registerRefactor();
  registerSources();
  registerCompute();
  registerPublish();
  registerConversation();
  registerBookmarks();
  registerClipper();
  registerApp();
}
