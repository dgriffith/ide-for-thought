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
import { registerRefactor } from './ipc/register-refactor';
import { registerSources } from './ipc/register-sources';
import { registerCompute } from './ipc/register-compute';
import { registerPublish } from './ipc/register-publish';
import { registerConversation } from './ipc/register-conversation';
import { registerBookmarks } from './ipc/register-bookmarks';

export function registerIpcHandlers(): void {
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
  registerRefactor();
  registerSources();
  registerCompute();
  registerPublish();
  registerConversation();
  registerBookmarks();
}
