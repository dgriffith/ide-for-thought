/**
 * "Find Opposing Arguments" research tool (#410).
 *
 * Mirror of `find-supporting-arguments` but for the rebutting case.
 * The model iterates with the user and eventually proposes a single
 * note whose frontmatter `rebuts: <claim-uri>` materialises a
 * `thought:rebuts` triple via the indexer — no separate graph-triples
 * payload.
 */

import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import {
  buildFindArgumentsSystemPrompt,
  buildFindArgumentsFirstMessage,
} from './find-arguments-shared';

registerTool({
  id: 'research.find-opposing-arguments',
  name: 'Find Opposing Arguments',
  category: 'research',
  description: 'Surface the strongest cases against a specific claim',
  longDescription:
    'Opens a conversation that surfaces the strongest cases against the thought:Claim under the cursor (web-grounded). ' +
    'When you are satisfied with the case, ask the assistant to file — you will see a draft note for review before anything lands.',
  context: ['claimUnderCursor'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => buildFindArgumentsSystemPrompt('oppose', ctx),
  buildFirstMessage: (ctx: ToolContext) => buildFindArgumentsFirstMessage('oppose', ctx),
});
