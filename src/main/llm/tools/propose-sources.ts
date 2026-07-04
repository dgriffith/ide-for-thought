import { randomUUID } from 'node:crypto';
import { detectIdentifier } from '../../sources/ingest-identifier';
import { normalizeUrl } from '../../sources/source-id';
import type {
  ConversationSourceDraft,
  DraftSource,
  ProposeSourcesInput,
} from '../../../shared/conversation-source-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * Counterpart to `runProposeNotes` for sources. The tool emits a draft
 * containing the validated URL/identifier list; the actual ingest runs
 * in the IPC handler for `CONVERSATION_FILE_SOURCE_DRAFT` once the user
 * approves the inline card. Trust-principle parity: the LLM proposes,
 * the human approves.
 */
function runProposeSources(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onSourceDraft) {
    return {
      content: 'propose_sources is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'propose_sources requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseProposeSourcesInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  const draft: ConversationSourceDraft = {
    draftId: `srcdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    sources: parsed.sources,
    createdAt: new Date().toISOString(),
  };
  callbacks.onSourceDraft(draft);

  const summary = parsed.sources
    .map((s) => s.identifier ?? s.url ?? '')
    .filter(Boolean)
    .join(', ');
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      sourceCount: parsed.sources.length,
      proposed: parsed.sources.map((s) =>
        s.identifier ? { identifier: s.identifier } : { url: s.url ?? '' },
      ),
      // Match the propose_notes hint so the model doesn't loop.
      hint:
        'STOP. The source bundle has been queued for user review. End this ' +
        'turn with ONE short acknowledgement sentence ("Proposed N source(s) ' +
        'for review.") and DO NOT call propose_sources again in this turn. ' +
        'DO NOT call any other tool. DO NOT repeat the URLs/identifiers ' +
        'inline.',
    }) + `\n\n(queued source draft: ${summary})`,
    isError: false,
  };
}

function parseProposeSourcesInput(
  input: unknown,
): ProposeSourcesInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_sources input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  if (!Array.isArray(obj.sources) || obj.sources.length === 0) {
    return { error: '`sources` must be a non-empty array. If you have no sources to '
      + 'file, do NOT call propose_sources — reply to the user in plain text instead.' };
  }
  const sources: DraftSource[] = [];
  for (const raw of obj.sources) {
    if (!raw || typeof raw !== 'object') {
      return { error: 'Each source entry must be an object.' };
    }
    const s = raw as Record<string, unknown>;
    const identifier = typeof s.identifier === 'string' ? s.identifier.trim() : '';
    const url = typeof s.url === 'string' ? s.url.trim() : '';
    if (identifier && url) {
      return {
        error:
          'Each source entry must supply exactly one of `identifier` or ' +
          `\`url\`, not both: ${JSON.stringify(raw)}`,
      };
    }
    if (!identifier && !url) {
      return {
        error:
          'Each source entry must supply exactly one of `identifier` or ' +
          `\`url\`: ${JSON.stringify(raw)}`,
      };
    }
    if (identifier) {
      if (!detectIdentifier(identifier)) {
        return {
          error:
            `Not a recognised DOI / arXiv id / PubMed id: ${identifier}. ` +
            'Examples: "10.1038/s41586-023-06924-6", "2301.12345", ' +
            '"12345678", "doi:10.…", "arXiv:2301.…", or the canonical ' +
            'doi.org / arxiv.org / pubmed URL.',
        };
      }
      sources.push({ identifier });
    } else {
      if (!normalizeUrl(url)) {
        return { error: `Not a valid http(s) URL: ${url}` };
      }
      sources.push({ url });
    }
  }
  return { note, sources };
}

export const proposeSources: NotebaseTool = {
  definition: {
    name: 'propose_sources',
    description:
      'Propose one or more sources (papers, articles, web pages) for the ' +
      'user to ingest into their Sources library. Use this when you have ' +
      'identified specific references the user would benefit from — a paper ' +
      'cited in a note, a foundational article on a topic they are ' +
      'exploring, a web resource the user would want filed for citation. ' +
      'The user reviews the bundle as an inline card; on Approve, Minerva ' +
      'runs its standard ingest pipeline (Readability for arbitrary URLs; ' +
      'Crossref / arXiv / PubMed for identifiers) to fetch metadata and ' +
      'archive the source under `.minerva/sources/<id>/`. Duplicates are ' +
      'detected automatically and skipped without overwriting — you can ' +
      'safely propose a source even if you are unsure whether the user ' +
      'already has it.\n' +
      '\n' +
      'For each source, supply EXACTLY ONE of:\n' +
      '  - `identifier`: a DOI (`10.1038/s41586-023-06924-6`), arXiv id ' +
      '(`2301.12345`), or PubMed id (`12345678`). Prefix-tolerant — `doi:`, ' +
      '`arXiv:`, `pmid:`, full URLs like `https://doi.org/10.…` and ' +
      '`https://arxiv.org/abs/…` all normalize correctly. **Prefer ' +
      'identifiers over URLs whenever available** — the ingest pipeline ' +
      'gets richer, structured metadata from Crossref/arXiv/PubMed than ' +
      'from page scraping, including authors, abstract, journal/venue, and ' +
      'open-access PDF when advertised.\n' +
      '  - `url`: an http(s) URL. Use only for sources without a stable ' +
      'identifier (blog posts, news articles, documentation pages, etc.).\n' +
      '\n' +
      'You may also call `web_search` first to find candidate sources, then ' +
      '`propose_sources` to file the best matches.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing why you are proposing these ' +
            'sources. Surfaced to the user on the inline review card.',
        },
        sources: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          description:
            'One or more sources to propose. Use a single propose_sources ' +
            'call for the whole bundle rather than several calls — the user ' +
            'reviews the bundle as one card.',
          items: {
            type: 'object',
            properties: {
              identifier: {
                type: 'string',
                description:
                  'DOI / arXiv id / PubMed id (prefix-tolerant). Mutually ' +
                  'exclusive with `url`.',
              },
              url: {
                type: 'string',
                description:
                  'http(s) URL of the source. Mutually exclusive with ' +
                  '`identifier`. Use only when no stable identifier exists.',
              },
            },
          },
        },
      },
      required: ['note', 'sources'],
    },
  },
  run: (ctx, input, callbacks) => runProposeSources(ctx, input, callbacks),
};
