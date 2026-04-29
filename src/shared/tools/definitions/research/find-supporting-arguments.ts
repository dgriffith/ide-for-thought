/**
 * "Find Supporting Arguments" research tool (#409).
 *
 * Conversational. Picks up the claim URI from the editor cursor (via
 * the `claimUnderCursor` context requirement), looks up the claim's
 * label + source-text, then opens a seeded conversation. The model
 * iterates with the user and eventually proposes a single note whose
 * frontmatter `supports: <claim-uri>` materialises a `thought:supports`
 * triple via the indexer — no separate graph-triples payload.
 */

import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import {
  buildFindArgumentsSystemPrompt,
  buildFindArgumentsFirstMessage,
} from './find-arguments-shared';

registerTool({
  id: 'research.find-supporting-arguments',
  name: 'Find Supporting Arguments',
  category: 'research',
  description: 'Surface the strongest cases in favour of a specific claim',
  longDescription:
    'Opens a conversation that surfaces the strongest cases in favour of the thought:Claim under the cursor (web-grounded). ' +
    'When you are satisfied with the case, ask the assistant to file — you will see a draft note for review before anything lands.',
  context: ['claimUnderCursor'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => buildFindArgumentsSystemPrompt('support', ctx),
  buildFirstMessage: (ctx: ToolContext) => buildFindArgumentsFirstMessage('support', ctx),
});
