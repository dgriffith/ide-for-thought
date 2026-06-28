import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import nodePath from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import * as fs from '../notebase/fs';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import * as search from '../search/index';
import * as vectors from '../embeddings/vector-store';
import type { RelatedHit, RefKind } from '../embeddings/vector-store';
import * as tables from '../sources/tables';
import ONTOLOGY_TTL from '../../shared/ontology.ttl?raw';
import THOUGHT_ONTOLOGY_TTL from '../../shared/ontology-thought.ttl?raw';
import type {
  ConversationDraft,
  DraftPayload,
  ProposeNotesInput,
} from '../../shared/conversation-drafts';
import type {
  ConversationSourceDraft,
  DraftSource,
  ProposeSourcesInput,
} from '../../shared/conversation-source-drafts';
import type {
  ConversationPropertyDraft,
  PropertyUpdate,
  SetPropertiesInput,
} from '../../shared/conversation-property-drafts';
import type {
  ConversationComputeDraft,
  ProposeComputeInput,
} from '../../shared/conversation-compute-drafts';
import type {
  ConversationSourcePropertyDraft,
  ProposeSourcePropertiesInput,
} from '../../shared/conversation-source-property-drafts';
import type { ConversationRefactorDraft, ConversationReorgDraft } from '../../shared/conversation-refactor-drafts';
import { planRename, RefactorError } from '../notebase/rename';
import { planReorg, type ReorgOperation } from '../notebase/reorg';
import { scanPythonSafety } from '../../shared/python-safety';
import type { ConversationToolKey } from '../../shared/conversation-tools';
import { fixupBundleLinks } from '../../shared/refactor/bundle-link-fixup';
import { readFrontmatterProperties } from '../../shared/refactor/frontmatter-patch';
import type { PropertyPatch, PropertyValue } from '../../shared/refactor/frontmatter-patch';
import { detectIdentifier } from '../sources/ingest-identifier';
import { normalizeUrl } from '../sources/source-id';
import { excerptIdFor } from '../sources/create-excerpt';
import {
  CLAIM_KINDS,
  type ClaimKind,
  type ConversationClaimsDraft,
  type DraftClaim,
  type ProposeClaimsInput,
} from '../../shared/conversation-claims-drafts';

export interface ToolContext {
  rootPath: string;
  /**
   * Identifier of the conversation this tool execution is bound to. Required
   * for any tool that drafts proposals (`propose_notes`) so the draft event
   * can be routed back to the right ConversationDialog. Optional for tools
   * that don't draft.
   */
  conversationId?: string;
}

/**
 * Side-channel callbacks the tool runner can invoke. Wired by the
 * conversation IPC handler — `onDraft` forwards `propose_notes` payloads
 * to the renderer; `askUser` round-trips a question through an inline
 * UI prompt and resolves with the user's reply.
 */
export interface ToolCallbacks {
  onDraft?: (draft: ConversationDraft) => void;
  /** Counterpart to `onDraft` for the `propose_sources` tool. Wired by
   *  the conversation IPC handler; forwards source-ingest drafts to the
   *  renderer via `Channels.CONVERSATION_SOURCE_DRAFT`. Without it,
   *  propose_sources errors with "no UI surface" — same shape as
   *  propose_notes when invoked outside a conversation context. */
  onSourceDraft?: (draft: ConversationSourceDraft) => void;
  /** Counterpart to `onDraft` for the `set_properties` tool. Forwards
   *  frontmatter-patch drafts to the renderer for inline review. */
  onPropertyDraft?: (draft: ConversationPropertyDraft) => void;
  /** Counterpart to `onPropertyDraft` for the `propose_source_properties`
   *  tool (#103). Forwards a source's proposed abstract / TL;DR to the
   *  renderer for inline review before anything touches the meta.ttl. */
  onSourcePropertyDraft?: (draft: ConversationSourcePropertyDraft) => void;
  /** Counterpart to `onDraft` for the `propose_claims` tool (#104). Forwards a
   *  source's extracted key claims (each with a supporting excerpt) to the
   *  renderer for inline review before any node is filed. */
  onClaimsDraft?: (draft: ConversationClaimsDraft) => void;
  /** Counterpart to `onDraft` for the `propose_compute` tool (#245).
   *  Forwards SPARQL / SQL / Python cell drafts to the renderer for
   *  inline review. The user clicks Run / Insert / Discard. */
  onComputeDraft?: (draft: ConversationComputeDraft) => void;
  /** Counterpart to `onDraft` for `propose_note_rename` / `propose_note_move`
   *  (#912). Forwards a note move/rename + its blast radius for inline review. */
  onRefactorDraft?: (draft: ConversationRefactorDraft) => void;
  /** Counterpart for `propose_reorganization` (#914) — a batch move/rename plan
   *  reviewed as one card with per-item toggles. */
  onReorgDraft?: (draft: ConversationReorgDraft) => void;
  askUser?: (input: { question: string; choices?: string[] }) => Promise<string>;
}

export const NOTEBASE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_notes',
    description:
      'Full-text search across all notes in the current thoughtbase. Returns ' +
      'matching notes ranked by relevance, with title, relative path, and a ' +
      'short snippet for each. Use this to find notes by keyword when you do ' +
      'not already know the exact path.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms. MiniSearch syntax is supported.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return. Defaults to 10.',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_note',
    description:
      'Read the full contents of a note by its thoughtbase-relative path ' +
      '(e.g. "notes/topics/llm-trust.md"). Returns the raw markdown including ' +
      'any frontmatter. Use this when you have a path from search_notes, from ' +
      'a wiki-link in another note, or from a graph query, and need the full ' +
      'text.',
    input_schema: {
      type: 'object',
      properties: {
        relative_path: {
          type: 'string',
          description:
            'Path relative to the thoughtbase root. Must include the file ' +
            'extension. Path traversal (..) is rejected.',
        },
      },
      required: ['relative_path'],
    },
  },
  {
    name: 'search_related',
    description:
      'Semantic (meaning-based) search across the thoughtbase — notes, source ' +
      'bodies, and excerpts. Returns items whose content is conceptually similar ' +
      'to a query, even when they share no keywords — embeddings, not text ' +
      'matching. Two modes: pass `query` for free-text ("how trust is ' +
      'established"), or `relative_path` to find items related to an existing ' +
      'note ("what else is like this one"). Optionally restrict with `kinds` ' +
      '(e.g. ["excerpt"] to mine the research library). Each result names its ' +
      'kind, the matched section, and a similarity score (0–1); a `[source]` / ' +
      '`[excerpt]` tag marks library hits (use read_note only for plain notes).\n' +
      'Choosing among the search tools: use search_related for "find things ' +
      'like / about this" by meaning; use search_notes for exact keywords or ' +
      'phrases; use query_graph for structural questions (links, tags, types, ' +
      'claims). They complement each other — combine when unsure.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text description of what to find, matched by meaning.',
        },
        relative_path: {
          type: 'string',
          description:
            'Instead of `query`, find notes related to this note (uses the ' +
            'note\'s own content as the query). The note itself is excluded.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of items to return. Defaults to 10.',
          minimum: 1,
          maximum: 50,
        },
        kinds: {
          type: 'array',
          description: 'Restrict to these corpora. Omit for all.',
          items: { type: 'string', enum: ['note', 'source', 'excerpt'] },
        },
      },
    },
  },
  {
    name: 'query_graph',
    description:
      'Run a SPARQL query against the thoughtbase knowledge graph. Standard ' +
      'prefixes (minerva, thought, dc, rdf, rdfs, xsd, csvw, prov) are ' +
      'auto-injected. The graph contains notes (minerva:Note), folders, tags, ' +
      'typed wiki-links (supports, rebuts, references, etc.), frontmatter ' +
      'metadata as minerva:meta-* predicates, and thought-ontology structures ' +
      '(claims, proposals, conversations). Use SELECT for tabular results. ' +
      'If you are unsure about predicate or class names, call ' +
      'describe_graph_schema first.',
    input_schema: {
      type: 'object',
      properties: {
        sparql: {
          type: 'string',
          description: 'A SPARQL query string (SELECT / ASK / CONSTRUCT).',
        },
      },
      required: ['sparql'],
    },
  },
  {
    name: 'list_notes',
    description:
      'List the thoughtbase structure: every note\'s relative path, title, and ' +
      'folder. Read-only. Use this to understand the current layout before ' +
      'proposing a reorganization (which folders exist, which notes are loose at ' +
      'the root, naming inconsistencies) — search_notes is for finding by ' +
      'keyword, this is for seeing the shape.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'propose_note_rename',
    description:
      'Propose renaming a note (keep its folder, change the filename). The user ' +
      'reviews a card showing the new name and every other note whose links ' +
      'would be rewritten, then approves or discards — nothing moves until then. ' +
      'Inbound wiki-links are updated automatically on approval.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The note\'s current thoughtbase-relative path (e.g. "notes/raft.md").' },
        newName: { type: 'string', description: 'The new filename, with or without ".md" (e.g. "raft-consensus").' },
      },
      required: ['path', 'newName'],
    },
  },
  {
    name: 'propose_note_move',
    description:
      'Propose moving a note to a different folder (keep its filename). The user ' +
      'reviews a card showing the destination and every note whose links would ' +
      'be rewritten, then approves or discards. Inbound wiki-links and relative ' +
      'paths are updated automatically on approval. Use list_notes first to see ' +
      'the folder structure.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The note\'s current thoughtbase-relative path.' },
        destFolder: { type: 'string', description: 'Destination folder, relative to the root (e.g. "notes/algorithms"). Empty string = move to the root.' },
      },
      required: ['path', 'destFolder'],
    },
  },
  {
    name: 'propose_reorganization',
    description:
      'Propose a whole reorganization — many note moves/renames at once — for the ' +
      'user to review as a single plan with per-item checkboxes (they can approve ' +
      'a subset). Use this instead of many propose_note_move/rename calls when ' +
      'restructuring a thoughtbase. Call list_notes first to see the current ' +
      'layout. Each operation gives the note\'s current `path` and its full target ' +
      '`newPath`. Inbound links are rewritten automatically on approval; nothing ' +
      'moves until the user approves.',
    input_schema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'The moves/renames that make up the plan.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The note\'s current thoughtbase-relative path.' },
              newPath: { type: 'string', description: 'The full destination path (folder + filename, ending in .md).' },
            },
            required: ['path', 'newPath'],
          },
        },
      },
      required: ['operations'],
    },
  },
  {
    name: 'propose_notes',
    description:
      'Propose one or more new notes for the user to review. Use this when ' +
      'you want to file structured prose into the thoughtbase (e.g. a ' +
      'learning-journey index + per-stop child notes, an explanation broken ' +
      'into linked sub-notes, a summary of a research finding). The user ' +
      'reviews the bundle as an inline card; Approve files them through the ' +
      'standard approval engine, Reject discards.\n' +
      '\n' +
      'CRITICAL — wiki-link rule: when one note in the bundle links to another, ' +
      'the wiki-link target MUST be the basename of the OTHER note\'s ' +
      'relativePath (filename without the .md extension), spelled IDENTICALLY. ' +
      'Wiki-link resolution is exact-match on basename — `[[Sets, Functions, ' +
      'and the Need for Types]]` only resolves to ' +
      '`notes/.../Sets, Functions, and the Need for Types.md`. Pick paths and ' +
      'link targets together, in one pass; do not invent friendlier names for ' +
      'links. Bad: `[[stop-1]]` while the file is `notes/.../Sets, Functions, ' +
      'and the Need for Types.md`. Good: `[[Sets, Functions, and the Need for ' +
      'Types]]`. Prefer paths without commas/punctuation in the basename if you ' +
      'can — they\'re easier to link to.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing why you are proposing this bundle. ' +
            'Surfaced to the user on the inline review card.',
        },
        payloads: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          description: 'One or more note payloads to file. Use a single propose_notes call for the whole bundle (parent + children) rather than several calls — the user reviews the bundle as one card.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['note'],
                description: 'Only "note" is supported today.',
              },
              relativePath: {
                type: 'string',
                description:
                  'Project-relative target path, e.g. "notes/distributed-consensus/raft.md". ' +
                  'Apply-time collision dedup will append "-2" if a file already exists at the path. ' +
                  'Pick basenames you are willing to use as wiki-link targets unchanged — see CRITICAL rule in the tool description.',
              },
              content: {
                type: 'string',
                description:
                  'Full note body in GitHub-flavored markdown. Include a level-1 heading and any frontmatter you want. ' +
                  'When linking to a sibling note in this same bundle, use [[<basename>]] where <basename> is the OTHER ' +
                  'payload\'s relativePath without the trailing ".md" — spelled IDENTICALLY (capitalisation, punctuation, spaces).',
              },
            },
            required: ['kind', 'relativePath', 'content'],
          },
        },
      },
      required: ['note', 'payloads'],
    },
  },
  {
    name: 'describe_graph_schema',
    description:
      'Return the full Minerva ontology as Turtle. Contains every class ' +
      '(minerva:Note, minerva:Tag, thought:Claim, etc.) and every predicate ' +
      '(minerva:supports, minerva:hasTag, dc:title, thought:hasClaim, etc.) ' +
      'used in the graph, with rdfs:label and rdfs:comment for each. Call ' +
      'this before writing a non-trivial SPARQL query if you are not sure ' +
      'what the schema looks like. The returned text is authoritative.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'describe_tables',
    description:
      'List the CSV-backed tables registered in DuckDB, with each table\'s ' +
      'columns and row count. This is the SQL counterpart to ' +
      'describe_graph_schema. Call it before writing a `query_sql` query (or ' +
      'a ```sql compute cell) when you are unsure what tables exist or what ' +
      'columns they have. Returns "no tables" when the thoughtbase has no ' +
      'CSV files registered.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'query_sql',
    description:
      'Run a read-only SQL query against the thoughtbase\'s DuckDB and get ' +
      'the rows back. Use this to actually inspect CSV table data (count, ' +
      'filter, join, aggregate) and reason over the result. This is the SQL ' +
      'counterpart to query_graph. Read-only: only SELECT / WITH / DESCRIBE ' +
      '/ SHOW / EXPLAIN / SUMMARIZE queries run; one statement at a time. If ' +
      'you are unsure about table or column names, call describe_tables ' +
      'first. (Use propose_compute instead when the user should review and ' +
      'keep the query as a cell.)',
    input_schema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'A read-only SQL query (SELECT / WITH / DESCRIBE / SHOW / …).',
        },
      },
      required: ['sql'],
    },
  },
  {
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
  {
    name: 'fetch_properties',
    description:
      'Read the YAML frontmatter properties of a note. Returns the ' +
      'frontmatter as a JSON object — keys like `title`, `tags`, `status`, ' +
      'custom user fields, etc. Returns `{}` when the note has no ' +
      'frontmatter or the YAML is malformed. Use this before ' +
      '`set_properties` when you need to read the existing value of a key ' +
      'you intend to update (e.g. to append to an array rather than ' +
      'replace it). Does not load the note body — call `read_note` for ' +
      'that.',
    input_schema: {
      type: 'object',
      properties: {
        relative_path: {
          type: 'string',
          description:
            'Path relative to the thoughtbase root, including the `.md` ' +
            'extension. Path traversal (..) is rejected.',
        },
      },
      required: ['relative_path'],
    },
  },
  {
    name: 'set_properties',
    description:
      'Propose YAML-frontmatter property updates on one or more notes. ' +
      'Use this for any structured-metadata change: setting a `status`, ' +
      'editing `tags`, recording a custom field like `priority` or ' +
      '`reviewed`, updating `title`, etc. The user reviews the bundle as ' +
      'an inline card; on Approve, each note is read, its frontmatter ' +
      'patched, and the file written back. On Discard nothing is written.\n' +
      '\n' +
      'Semantics: SHALLOW MERGE. Listed keys replace the value at that ' +
      'key; setting a value to `null` deletes the key; other keys in the ' +
      "frontmatter are left untouched. If you need to append to an array " +
      'rather than replace it, call `fetch_properties` first to read the ' +
      'current value, then submit the combined array.\n' +
      '\n' +
      'Use ONE `set_properties` call for the whole bundle (the user reviews ' +
      'all updates as a single card) rather than calling it once per note. ' +
      'When the only change is adding/removing a tag, you may still prefer ' +
      '`set_properties` with `{ tags: [...] }` so the user sees the diff ' +
      'instead of a silent tag mutation.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing why you are proposing this ' +
            'update. Surfaced to the user on the inline review card.',
        },
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          description:
            'One or more per-note patches. Each entry targets one note ' +
            'and shallow-merges its `properties` into the frontmatter.',
          items: {
            type: 'object',
            properties: {
              relativePath: {
                type: 'string',
                description:
                  'Project-relative path to the note (include `.md`). The ' +
                  'note must already exist — use `propose_notes` to ' +
                  'create new notes.',
              },
              properties: {
                type: 'object',
                description:
                  'Shallow patch. Each key is set to the given value; a ' +
                  '`null` value deletes the key. Values may be strings, ' +
                  'numbers, booleans, arrays, or nested objects — anything ' +
                  'YAML can encode.',
                additionalProperties: true,
              },
            },
            required: ['relativePath', 'properties'],
          },
        },
      },
      required: ['note', 'updates'],
    },
  },
  {
    name: 'propose_source_properties',
    description:
      'Propose summary metadata for a SOURCE (not a note): a formal ' +
      '`abstract` and/or a one-paragraph plain-language `tldr`. Use this ' +
      'when asked to summarize a source. The user reviews the proposal as ' +
      'an inline card; on Approve, `dc:abstract` / `thought:tldr` are ' +
      "written to the source's metadata and the graph re-indexed. On " +
      'Discard nothing is written.\n' +
      '\n' +
      'Provide at least one of `abstract` / `tldr`. Submit ONE call for the ' +
      'source — do not call it repeatedly. The `sourceId` is given to you in ' +
      'the conversation context; pass it through verbatim.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing what you are proposing. Surfaced ' +
            'to the user on the inline review card.',
        },
        sourceId: {
          type: 'string',
          description:
            'Id of the source to annotate (provided in the conversation ' +
            'context). Must match an existing source.',
        },
        abstract: {
          type: 'string',
          description:
            'A concise scholarly abstract (1–2 paragraphs), written in the ' +
            "source's own register. Omit if you are only proposing a TL;DR.",
        },
        tldr: {
          type: 'string',
          description:
            'A single plain-language paragraph a non-expert could follow — ' +
            'the "what is this and why does it matter" gist. Omit if you ' +
            'are only proposing an abstract.',
        },
      },
      required: ['note', 'sourceId'],
    },
  },
  {
    name: 'propose_claims',
    description:
      'Propose the key claims a SOURCE makes, each anchored to a supporting ' +
      'excerpt. Use this when asked to extract / mine claims from a source. ' +
      'The user reviews the list as an inline card; on Approve, each claim is ' +
      'filed as a thought:Claim note that cites a thought:Excerpt (anchored ' +
      'into the body) and carries its confidence. On Discard nothing is ' +
      'written.\n' +
      '\n' +
      'For each claim, the `quote` MUST be copied **verbatim** from the source ' +
      'body — it is used to locate and anchor the excerpt; a paraphrase will ' +
      'still file but loses the character-range anchor. Extract the *key* ' +
      'claims, not every atom. The `sourceId` is given in the conversation ' +
      'context; pass it through verbatim. Submit ONE call.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing what you are proposing. Surfaced to ' +
            'the user on the inline review card.',
        },
        sourceId: {
          type: 'string',
          description: 'Id of the source the claims come from (from context).',
        },
        claims: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The claim as a concise assertion.' },
              kind: {
                type: 'string',
                enum: ['factual', 'evaluative', 'definitional', 'predictive'],
                description: 'factual (a state of the world), evaluative (a value judgment), definitional (what a term means), or predictive (what will happen).',
              },
              quote: {
                type: 'string',
                description: 'A verbatim passage from the source body that supports the claim.',
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Your confidence (0–1) that the source actually makes this claim.',
              },
            },
            required: ['text', 'kind', 'quote', 'confidence'],
          },
        },
      },
      required: ['note', 'sourceId', 'claims'],
    },
  },
  {
    name: 'propose_compute',
    description:
      'Propose a code cell (SPARQL, SQL, or Python) for the user to review and run. ' +
      'Use this when answering a question would benefit from actual computation over ' +
      'the user\'s data — counting graph nodes, joining CSV tables, fitting a model, ' +
      'plotting a distribution — rather than your own narrative answer. The cell is ' +
      'rendered as a reviewable inline card; the user clicks Run to execute it, ' +
      'Insert into notebook to file it as a permanent cell, or Discard. Per the ' +
      'Trust Principle, you cannot execute code yourself — every cell goes through ' +
      'human review first.\n' +
      '\n' +
      'After Run, the output is appended to the conversation as context for your ' +
      'NEXT turn — so you can comment on the result, refine the query, or propose ' +
      'a follow-up cell. Don\'t describe the expected output inline; let the user ' +
      'run it and see.\n' +
      '\n' +
      'Language guidance:\n' +
      '  - `sparql` — query the knowledge graph (notes, tags, claims, sources, etc.). ' +
      'Use the standard minerva/thought/dc prefixes; they\'re auto-injected.\n' +
      '  - `sql` — query CSV tables registered in DuckDB. Table names follow the ' +
      'project-relative path with `/` and `.` collapsed to `_` (or the user\'s ' +
      '`table_name:` override). Call `describe_tables` to list tables + columns; ' +
      'use `query_sql` if you just need to see the data yourself rather than ' +
      'leaving the user a cell.\n' +
      '  - `python` — pandas / numpy / matplotlib analysis. Network calls, ' +
      'subprocess, and file-write APIs are flagged in the UI and require an extra ' +
      'confirmation — avoid them unless genuinely necessary.\n' +
      '\n' +
      'The `minerva` Python module is the canonical way to reach project data ' +
      '(just `import minerva` at the top of the cell). Every helper returns ' +
      'plain dicts / lists of dicts — NOT custom classes. Access fields with ' +
      'bracket notation (`note[\'body\']`), not dot notation.\n' +
      '\n' +
      '  minerva.sparql(query) -> pandas.DataFrame\n' +
      '    Columns match the SELECT variable names verbatim (no `?` prefix).\n' +
      '    SELECT ?relativePath ?title  →  df columns: [\'relativePath\', \'title\']\n' +
      '\n' +
      '  minerva.sql(query) -> pandas.DataFrame\n' +
      '    Columns match the SQL projection.\n' +
      '\n' +
      '  minerva.notes.read(rel_path) -> dict\n' +
      '    Returns {\'relativePath\', \'title\', \'frontmatter\', \'tags\', \'body\'}.\n' +
      '    To get the markdown source: minerva.notes.read(p)[\'body\'].\n' +
      '\n' +
      '  minerva.notes.by_tag(tag) -> list[dict]\n' +
      '    Each item: {\'relativePath\', \'title\'}.\n' +
      '\n' +
      '  minerva.notes.search(query, limit=20) -> list[dict]\n' +
      '    Each item: {\'relativePath\', \'title\', \'snippet\', \'score\'}.\n' +
      '\n' +
      '  minerva.sources.get(source_id) -> dict (SourceDetail)\n' +
      '  minerva.sources.citing(source_id) -> list[dict]\n' +
      '  minerva.excerpts.for_source(source_id) -> list[str]\n' +
      '  minerva.ctx() -> {\'project_root\': str, \'notebook_path\': str | None}\n' +
      '\n' +
      'Common pitfalls to avoid:\n' +
      '  - There is no `from minerva import read_note`. Use `minerva.notes.read(p)`.\n' +
      '  - DataFrame columns are NOT renamed for ergonomics — `?relativePath` in ' +
      'SPARQL becomes `df[\'relativePath\']`, not `df[\'path\']`. Match the column ' +
      'name to the variable name exactly.\n' +
      '  - Notes are dicts; field access is `note[\'body\']` not `note.body`.\n' +
      '  - For the project root, use `minerva.ctx()[\'project_root\']` rather than ' +
      '`os.environ` so you don\'t trip the safety scan.\n' +
      '\n' +
      'One proposal per turn. End the turn with a one-sentence preamble (e.g. ' +
      '"I drafted a query — run it when ready.") and stop.',
    input_schema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['sparql', 'sql', 'python'],
          description:
            'Which executor the cell targets. SPARQL hits the graph; SQL hits DuckDB ' +
            'over registered CSV tables; Python runs in the project\'s kernel.',
        },
        code: {
          type: 'string',
          description:
            'The cell body, exactly as you want the user to see it. No surrounding ' +
            'markdown fence; the renderer adds language-aware syntax highlighting. ' +
            'Make the cell self-contained — the user may run it without your turn ' +
            'still in scope.',
        },
        rationale: {
          type: 'string',
          description:
            'One short sentence describing what this cell will compute and why ' +
            'it\'s the right answer to the user\'s question. Surfaced on the card.',
        },
      },
      required: ['language', 'code', 'rationale'],
    },
  },
];

/**
 * Template-scoped tools. NOT in the default toolset; templates opt in via
 * `requiresTools: ['ask_user']` on their ConversationTemplate definition.
 * Keeps "ask the user" from becoming a crutch in freeform conversations
 * where there is no UI affordance to render the question.
 */
const ASK_USER_TOOL: Anthropic.Tool = {
  name: 'ask_user',
  description:
    'Ask the user a question and wait for their reply. Use this ONLY when ' +
    'you need a decision you cannot reasonably resolve via the other tools ' +
    '(search, read, query) AND that materially changes what you produce. ' +
    'Examples: "should I split by section or by topic?", "which of these two ' +
    'interpretations should I run with?". Do NOT use this for confirmation, ' +
    'politeness, or to summarize what you are about to do — only for ' +
    'genuinely missing decisions. The user sees an inline prompt; their ' +
    'reply (free text or one of the choices) becomes the tool result.',
  input_schema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'A short, specific question. One sentence when possible. ' +
          'Provide only the question — no preamble, no explanation.',
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of suggested answers, rendered as clickable chips. ' +
          'The user may still answer freely. Omit when the question is genuinely open.',
        maxItems: 8,
      },
    },
    required: ['question'],
  },
};

const TEMPLATE_TOOL_REGISTRY: Record<ConversationToolKey, Anthropic.Tool> = {
  ask_user: ASK_USER_TOOL,
};

/**
 * Server-side tools run on Anthropic's infrastructure — we just declare them
 * in the request and the API executes queries/fetches and returns structured
 * citations. Version _20260209 bundles dynamic filtering (Claude filters
 * results with code before they hit its context window).
 *
 * `allowed_domains` / `blocked_domains` are passed through per user setting;
 * they're mutually exclusive from the model's perspective but the API accepts
 * either independently.
 */
export function buildWebTools(opts: {
  allowedDomains?: string[];
  blockedDomains?: string[];
}): Anthropic.Messages.ToolUnion[] {
  const webSearch: Anthropic.Messages.WebSearchTool20260209 = {
    type: 'web_search_20260209',
    name: 'web_search',
  };
  if (opts.allowedDomains && opts.allowedDomains.length > 0) {
    webSearch.allowed_domains = opts.allowedDomains;
  } else if (opts.blockedDomains && opts.blockedDomains.length > 0) {
    webSearch.blocked_domains = opts.blockedDomains;
  }
  const webFetch: Anthropic.Messages.WebFetchTool20260209 = {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
  };
  if (opts.allowedDomains && opts.allowedDomains.length > 0) {
    webFetch.allowed_domains = opts.allowedDomains;
  } else if (opts.blockedDomains && opts.blockedDomains.length > 0) {
    webFetch.blocked_domains = opts.blockedDomains;
  }
  return [webSearch, webFetch];
}

export interface ConversationToolOptions {
  web: {
    enabled: boolean;
    allowedDomains?: string[];
    blockedDomains?: string[];
  };
  /** Template-scoped tools to add on top of the default set. */
  extraTools?: ConversationToolKey[];
}

export function buildConversationTools(
  opts: ConversationToolOptions,
): Anthropic.Messages.ToolUnion[] {
  const tools: Anthropic.Messages.ToolUnion[] = [...NOTEBASE_TOOLS];
  if (opts.web.enabled) {
    tools.push(...buildWebTools({
      allowedDomains: opts.web.allowedDomains,
      blockedDomains: opts.web.blockedDomains,
    }));
  }
  if (opts.extraTools) {
    const seen = new Set<string>();
    for (const key of opts.extraTools) {
      if (seen.has(key)) continue;
      seen.add(key);
      const t = TEMPLATE_TOOL_REGISTRY[key];
      if (t) tools.push(t);
    }
  }
  return tools;
}

export async function executeNotebaseTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
  callbacks: ToolCallbacks = {},
): Promise<{ content: string; isError: boolean }> {
  try {
    switch (name) {
      case 'search_notes':
        return { content: runSearch(ctx, input), isError: false };
      case 'read_note':
        return { content: await runRead(ctx, input), isError: false };
      case 'query_graph':
        return runQuery(ctx, input);
      case 'search_related':
        return await runSearchRelated(ctx, input);
      case 'list_notes':
        return { content: await runListNotes(ctx), isError: false };
      case 'propose_note_rename':
        return await runProposeNoteRename(ctx, input, callbacks);
      case 'propose_note_move':
        return await runProposeNoteMove(ctx, input, callbacks);
      case 'propose_reorganization':
        return await runProposeReorganization(ctx, input, callbacks);
      case 'describe_graph_schema':
        return { content: runDescribeSchema(), isError: false };
      case 'describe_tables':
        return runDescribeTables(ctx);
      case 'query_sql':
        return runQuerySql(ctx, input);
      case 'propose_notes':
        return runProposeNotes(ctx, input, callbacks);
      case 'propose_sources':
        return runProposeSources(ctx, input, callbacks);
      case 'fetch_properties':
        return { content: await runFetchProperties(ctx, input), isError: false };
      case 'set_properties':
        return runSetProperties(ctx, input, callbacks);
      case 'propose_source_properties':
        return runProposeSourceProperties(ctx, input, callbacks);
      case 'propose_claims':
        return runProposeClaims(ctx, input, callbacks);
      case 'propose_compute':
        return runProposeCompute(ctx, input, callbacks);
      case 'ask_user':
        return runAskUser(input, callbacks);
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: `Tool ${name} failed: ${message}`, isError: true };
  }
}

function runSearch(ctx: ToolContext, input: unknown): string {
  const { query, limit } = input as { query: string; limit?: number };
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('query is required');
  }
  const results = search.search(projectContext(ctx.rootPath), query, { limit: limit ?? 10 });
  if (results.length === 0) {
    return `No results for "${query}".`;
  }
  return results
    .map((r, i) => {
      const snippet = r.snippet.replace(/\s+/g, ' ').trim().slice(0, 240);
      return `${i + 1}. ${r.title} (${r.relativePath})\n   ${snippet}`;
    })
    .join('\n');
}

async function runSearchRelated(
  ctx: ToolContext,
  input: unknown,
): Promise<{ content: string; isError: boolean }> {
  const { query, relative_path, limit, kinds } = input as {
    query?: string; relative_path?: string; limit?: number; kinds?: RefKind[];
  };
  const pctx = projectContext(ctx.rootPath);

  if (!vectors.isEnabled(pctx)) {
    return {
      content: 'Semantic search is not available for this thoughtbase (embeddings are not initialized).',
      isError: false,
    };
  }

  const n = Math.min(Math.max(Math.floor(limit ?? 10), 1), 50);
  const kindFilter = Array.isArray(kinds) && kinds.length > 0 ? kinds : undefined;
  let hits: RelatedHit[];
  let descriptor: string;

  if (typeof relative_path === 'string' && relative_path.trim()) {
    // Over-fetch chunk-level hits so best-per-ref de-dup still yields ~n results.
    hits = await vectors.relatedToNote(pctx, relative_path.trim(), { limit: n * 5, kinds: kindFilter });
    descriptor = `related to ${relative_path.trim()}`;
    if (hits.length === 0) {
      return {
        content:
          `No related items found for "${relative_path.trim()}". The note may not be ` +
          `indexed yet — semantic indexing runs in the background, so results can be ` +
          `incomplete shortly after a note is created or the model changes.`,
        isError: false,
      };
    }
  } else if (typeof query === 'string' && query.trim()) {
    hits = await vectors.searchRelated(pctx, query.trim(), { limit: n * 5, kinds: kindFilter });
    descriptor = `for "${query.trim()}"`;
  } else {
    throw new Error('Provide either `query` (free text) or `relative_path` (a note to find relatives of).');
  }

  const best = bestPerRef(hits).slice(0, n);
  if (best.length === 0) {
    return { content: `No semantically related items found ${descriptor}.`, isError: false };
  }
  const body = best
    .map((h, i) => {
      const heading = h.sectionHeading || '(intro)';
      const snippet = h.chunkText.replace(/\s+/g, ' ').trim().slice(0, 240);
      // Label the corpus so the model can route (read_note vs. a source/excerpt).
      const tag = h.kind === 'note' ? '' : `[${h.kind}] `;
      return `${i + 1}. ${tag}${h.ref} — ${heading} (similarity ${h.score.toFixed(2)})\n   ${snippet}`;
    })
    .join('\n');
  return { content: body, isError: false };
}

/** Collapse chunk-level hits to one row per (kind, ref), keeping each ref's best
 *  (highest-scoring) chunk, ordered by score descending. */
function bestPerRef(hits: RelatedHit[]): RelatedHit[] {
  const best = new Map<string, RelatedHit>();
  for (const h of hits) {
    const key = `${h.kind}:${h.ref}`;
    const prev = best.get(key);
    if (!prev || h.score > prev.score) best.set(key, h);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

// ── Note-refactor proposals (#912) ──────────────────────────────────────────

async function runListNotes(ctx: ToolContext): Promise<string> {
  const pctx = projectContext(ctx.rootPath);
  const notes = (await listProjectNotes(ctx.rootPath)).sort();
  if (notes.length === 0) return 'No notes in this thoughtbase.';
  const lines = notes.map((p) => `${p} — ${graph.noteTitle(pctx, p)}`);
  return `${notes.length} notes:\n${lines.join('\n')}`;
}

/** Every indexable `.md` note under the root, skipping hidden + ignored dirs. */
async function listProjectNotes(rootPath: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(nodePath.relative(rootPath, full));
    }
  }
  await walk(rootPath);
  return out;
}

async function runProposeNoteRename(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  const { path: notePath, newName } = input as { path?: string; newName?: string };
  if (typeof notePath !== 'string' || !notePath.trim()) return { content: 'path is required.', isError: true };
  if (typeof newName !== 'string' || !newName.trim()) return { content: 'newName is required.', isError: true };
  const from = notePath.trim();
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  let base = newName.trim().split('/').pop()!; // a filename, never a path
  if (!base.endsWith('.md')) base += '.md';
  const to = dir ? `${dir}/${base}` : base;
  return runProposeRefactor(ctx, from, to, callbacks, 'Rename');
}

async function runProposeNoteMove(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  const { path: notePath, destFolder } = input as { path?: string; destFolder?: string };
  if (typeof notePath !== 'string' || !notePath.trim()) return { content: 'path is required.', isError: true };
  if (typeof destFolder !== 'string') return { content: 'destFolder is required (use "" to move to the root).', isError: true };
  const from = notePath.trim();
  const base = from.split('/').pop()!;
  const folder = destFolder.trim().replace(/^\/+|\/+$/g, '');
  const to = folder ? `${folder}/${base}` : base;
  return runProposeRefactor(ctx, from, to, callbacks, 'Move');
}

/** Shared core: dry-run the rename (validates guardrails + computes the blast
 *  radius), then emit a refactor draft for review. Never moves the note. */
async function runProposeRefactor(
  ctx: ToolContext, fromPath: string, toPath: string, callbacks: ToolCallbacks, verb: 'Rename' | 'Move',
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onRefactorDraft) {
    return { content: `propose_note_${verb.toLowerCase()} is only available in conversation contexts.`, isError: true };
  }
  if (!ctx.conversationId) {
    return { content: `propose_note_${verb.toLowerCase()} requires a bound conversation id.`, isError: true };
  }
  let plan: Awaited<ReturnType<typeof planRename>>;
  try {
    plan = await planRename(ctx.rootPath, fromPath, toPath);
  } catch (e) {
    if (e instanceof RefactorError) return { content: `Cannot ${verb.toLowerCase()}: ${e.message}`, isError: true };
    throw e;
  }

  const draft: ConversationRefactorDraft = {
    draftId: `refactor-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: `${verb} ${fromPath} → ${toPath}`,
    fromPath,
    toPath,
    affectedNotes: plan.affectedNotes.map((a) => ({ path: a.path, before: a.before, after: a.after, isMoved: a.isMoved })),
    createdAt: new Date().toISOString(),
  };
  callbacks.onRefactorDraft(draft);

  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      fromPath,
      toPath,
      notesWithLinkRewrites: plan.affectedNotes.filter((a) => !a.isMoved).length,
      hint: 'STOP. The move/rename is queued for the user to review and approve — nothing has changed yet. ' +
        'End the turn with one short acknowledgement and do NOT call this tool again this turn.',
    }),
    isError: false,
  };
}

async function runProposeReorganization(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onReorgDraft) return { content: 'propose_reorganization is only available in conversation contexts.', isError: true };
  if (!ctx.conversationId) return { content: 'propose_reorganization requires a bound conversation id.', isError: true };

  const { operations } = input as { operations?: unknown };
  if (!Array.isArray(operations) || operations.length === 0) {
    return { content: 'operations is required: a non-empty array of { path, newPath }.', isError: true };
  }
  const ops: ReorgOperation[] = [];
  for (const o of operations) {
    const op = o as { path?: unknown; newPath?: unknown };
    if (typeof op.path !== 'string' || !op.path.trim() || typeof op.newPath !== 'string' || !op.newPath.trim()) {
      return { content: 'each operation needs a non-empty string `path` and `newPath`.', isError: true };
    }
    ops.push({ path: op.path.trim(), newPath: op.newPath.trim() });
  }

  const plan = await planReorg(ctx.rootPath, ops);
  if (plan.items.length === 0) {
    return { content: `No operations could be planned. ${plan.warnings.join(' ')}`.trim(), isError: true };
  }

  const draft: ConversationReorgDraft = {
    draftId: `reorg-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: `Reorganize ${plan.items.length} note${plan.items.length === 1 ? '' : 's'}`,
    items: plan.items.map((i) => ({ fromPath: i.fromPath, toPath: i.toPath, affectedNotes: i.affectedNotes })),
    warnings: plan.warnings,
    createdAt: new Date().toISOString(),
  };
  callbacks.onReorgDraft(draft);

  const linkRewrites = new Set(plan.items.flatMap((i) => i.affectedNotes.filter((a) => !a.isMoved).map((a) => a.path)));
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      notesMoved: plan.items.length,
      notesWithLinkRewrites: linkRewrites.size,
      warnings: plan.warnings,
      hint: 'STOP. The reorganization plan is queued for the user to review (per-item) and approve — nothing has moved. ' +
        'End the turn with one short acknowledgement and do NOT call this tool again this turn.',
    }),
    isError: false,
  };
}

async function runRead(ctx: ToolContext, input: unknown): Promise<string> {
  const { relative_path } = input as { relative_path: string };
  if (typeof relative_path !== 'string' || !relative_path) {
    throw new Error('relative_path is required');
  }
  return fs.readFile(ctx.rootPath, relative_path);
}

async function runQuery(ctx: ToolContext, input: unknown): Promise<{ content: string; isError: boolean }> {
  const { sparql } = input as { sparql: string };
  if (typeof sparql !== 'string' || !sparql.trim()) {
    throw new Error('sparql is required');
  }
  const response = await graph.queryGraph(projectContext(ctx.rootPath), sparql);
  if (response.error) {
    return {
      content: `SPARQL error: ${response.error}\n\nCall describe_graph_schema to see available classes and predicates.`,
      isError: true,
    };
  }
  if (response.results.length === 0) {
    return { content: 'No bindings.', isError: false };
  }
  return { content: JSON.stringify(response.results, null, 2), isError: false };
}

/**
 * The propose_notes tool deliberately does NOT call proposeWrite. Doing
 * so here would file the bundle behind the user's back, which violates
 * the trust principle ("LLM proposes, human approves"). Instead it
 * builds a ConversationDraft, hands it to the renderer via the
 * onDraft callback, and returns to the model with a brief
 * acknowledgement.
 */
function runProposeNotes(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onDraft) {
    return {
      content: 'propose_notes is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'propose_notes requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseProposeNotesInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  // Models routinely pick human-readable relativePaths ("Sets, Functions,
  // and the Need for Types.md") and link them with shorter convenience
  // names ("[[stop-1]]") — those don't resolve. Walk the bundle and
  // rewrite inter-bundle wiki-links so they target sibling basenames.
  const fixup = fixupBundleLinks(
    parsed.payloads.map((p) => ({ relativePath: p.relativePath, content: p.content })),
  );
  if (fixup.rewritten.length > 0) {
    console.log(
      `[propose_notes] rewrote ${fixup.rewritten.reduce((n, r) => n + r.rewrites.length, 0)} ` +
      `inter-bundle wiki-link(s) across ${fixup.rewritten.length} note(s)`,
    );
  }
  const fixedPayloads: DraftPayload[] = parsed.payloads.map((p, i) => ({
    kind: 'note',
    relativePath: p.relativePath,
    content: fixup.notes[i].content,
  }));

  const draft: ConversationDraft = {
    draftId: `draft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    payloads: fixedPayloads,
    createdAt: new Date().toISOString(),
  };
  callbacks.onDraft(draft);

  const titles = parsed.payloads.map((p) => p.relativePath).join(', ');
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      noteCount: parsed.payloads.length,
      paths: parsed.payloads.map((p) => p.relativePath),
      // Be very explicit about stopping. An ambiguous "continue naturally"
      // hint led the model into a tool-use loop — calling propose_notes
      // again, and again, and again, up to maxIterations.
      hint: 'STOP. The bundle has been queued for user review. End this turn with ONE short acknowledgement sentence ("Drafted N notes for review.") and DO NOT call propose_notes again in this turn. DO NOT call any other tool. DO NOT repeat the note contents inline.',
    }) + `\n\n(filed as draft: ${titles})`,
    isError: false,
  };
}

function parseProposeNotesInput(
  input: unknown,
): ProposeNotesInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_notes input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  if (!Array.isArray(obj.payloads) || obj.payloads.length === 0) {
    return {
      error: '`payloads` must be a non-empty array. If you have no concrete notes '
        + 'to file, do NOT call propose_notes — reply to the user in plain markdown '
        + 'text instead.',
    };
  }
  const payloads: DraftPayload[] = [];
  for (const raw of obj.payloads) {
    if (!raw || typeof raw !== 'object') {
      return { error: 'Each payload must be an object.' };
    }
    const p = raw as Record<string, unknown>;
    if (p.kind !== 'note') {
      return { error: `Unsupported payload kind: ${String(p.kind)}. Only "note" is supported today.` };
    }
    const relativePath = typeof p.relativePath === 'string' ? p.relativePath.trim() : '';
    const content = typeof p.content === 'string' ? p.content : '';
    if (!relativePath) return { error: 'payload.relativePath is required.' };
    if (!content) return { error: 'payload.content is required.' };
    if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      return { error: `Unsafe relativePath: ${relativePath}` };
    }
    payloads.push({ kind: 'note', relativePath, content });
  }
  return { note, payloads };
}

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

async function runAskUser(
  input: unknown,
  callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.askUser) {
    return {
      content: 'ask_user is not available in this context — the conversation surface has no UI to render the question.',
      isError: true,
    };
  }
  if (!input || typeof input !== 'object') {
    return { content: 'ask_user input must be an object.', isError: true };
  }
  const obj = input as Record<string, unknown>;
  const question = typeof obj.question === 'string' ? obj.question.trim() : '';
  if (!question) {
    return { content: 'ask_user requires a non-empty `question` string.', isError: true };
  }
  let choices: string[] | undefined;
  if (Array.isArray(obj.choices)) {
    const filtered = obj.choices
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .map((c) => c.trim());
    if (filtered.length > 0) choices = filtered;
  }
  const answer = await callbacks.askUser({ question, choices });
  return { content: answer, isError: false };
}

function runDescribeSchema(): string {
  return [
    '# Minerva Core Ontology (minerva:)',
    '',
    ONTOLOGY_TTL,
    '',
    '# Thought Ontology (thought:)',
    '',
    THOUGHT_ONTOLOGY_TTL,
  ].join('\n');
}

/** describe_tables (#780): list registered DuckDB/CSV tables + their columns. */
async function runDescribeTables(ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const list = await tables.listTables(projectContext(ctx.rootPath));
  if (list.length === 0) {
    return {
      content:
        'No CSV tables are registered in this thoughtbase. Add a `.csv` file ' +
        '(optionally with a companion `.md` carrying a `table_name:` override) ' +
        'to create one.',
      isError: false,
    };
  }
  const lines = list.map((t) => {
    const cols = t.columns.length ? t.columns.join(', ') : '(no columns)';
    const rows = `${t.rowCount} row${t.rowCount === 1 ? '' : 's'}`;
    return `- ${t.name} — ${rows}, from ${t.relativePath}\n    columns: ${cols}`;
  });
  return {
    content:
      'Registered DuckDB tables (query with query_sql or a ```sql cell):\n\n' +
      lines.join('\n'),
    isError: false,
  };
}

const SQL_READONLY_FIRST_WORDS = new Set([
  'SELECT', 'WITH', 'DESCRIBE', 'SHOW', 'EXPLAIN', 'SUMMARIZE', 'TABLE', 'FROM', 'VALUES', 'PIVOT', 'UNPIVOT',
]);
const QUERY_SQL_ROW_CAP = 200;

/** query_sql (#781): immediate read-only SQL over the project's DuckDB. */
async function runQuerySql(ctx: ToolContext, input: unknown): Promise<{ content: string; isError: boolean }> {
  const { sql } = input as { sql: string };
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('sql is required');
  }
  // Read-only gate: single statement whose leading keyword is a query form.
  // CSV tables are a read surface; mutations go through propose_compute.
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (/;/.test(trimmed)) {
    return {
      content: 'query_sql runs one statement at a time — remove the extra `;`-separated statements.',
      isError: true,
    };
  }
  const firstWord = trimmed.match(/^\s*(\w+)/)?.[1]?.toUpperCase();
  if (!firstWord || !SQL_READONLY_FIRST_WORDS.has(firstWord)) {
    return {
      content:
        'query_sql is read-only — start with SELECT / WITH / DESCRIBE / SHOW / EXPLAIN / SUMMARIZE. ' +
        'Use propose_compute to propose a cell for anything that modifies state.',
      isError: true,
    };
  }
  const response = await tables.runQuery(projectContext(ctx.rootPath), trimmed);
  if (!response.ok) {
    return {
      content: `SQL error: ${response.error}\n\nCall describe_tables to see available tables and columns.`,
      isError: true,
    };
  }
  if (response.rows.length === 0) {
    return { content: 'No rows.', isError: false };
  }
  const shown = response.rows.slice(0, QUERY_SQL_ROW_CAP);
  const body = JSON.stringify(shown, null, 2);
  const note =
    response.rows.length > QUERY_SQL_ROW_CAP
      ? `\n\n(${response.rows.length} rows total; showing the first ${QUERY_SQL_ROW_CAP}. Add LIMIT or aggregate to narrow.)`
      : '';
  return { content: body + note, isError: false };
}

/**
 * Trust-principle parity with the other propose_* tools (#245):
 * `propose_compute` never executes the cell. It validates the input,
 * runs the Python-safety scan (no-op for sparql/sql), and emits a
 * `ConversationComputeDraft`. The renderer shows an inline reviewable
 * card; the user clicks Run to execute, Insert to file as a notebook
 * cell, or Discard.
 */
function runProposeCompute(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onComputeDraft) {
    return {
      content: 'propose_compute is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'propose_compute requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseProposeComputeInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }
  const safetyFlags = parsed.language === 'python'
    ? scanPythonSafety(parsed.code).map((f) => ({ id: f.id, message: f.message }))
    : [];
  const draft: ConversationComputeDraft = {
    draftId: `cmpdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    language: parsed.language,
    code: parsed.code,
    rationale: parsed.rationale,
    safetyFlags,
    createdAt: new Date().toISOString(),
  };
  callbacks.onComputeDraft(draft);
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      language: draft.language,
      safetyFlags: safetyFlags.map((f) => f.id),
      // Same anti-loop hint that propose_notes / propose_sources /
      // set_properties use. The model otherwise tends to re-emit the
      // proposal in subsequent iterations of the same turn.
      hint:
        'STOP. The cell has been queued for the user to review. End this ' +
        'turn with ONE short acknowledgement sentence (e.g. "I drafted a ' +
        `${parsed.language} cell — run it when ready.") and DO NOT call ` +
        'propose_compute again in this turn. DO NOT call any other tool. ' +
        'The cell output will arrive in the NEXT turn as user-role context — ' +
        'comment on it then.',
    }) + `\n\n(queued ${parsed.language} draft)`,
    isError: false,
  };
}

function parseProposeComputeInput(input: unknown): ProposeComputeInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_compute input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const language = obj.language;
  if (language !== 'sparql' && language !== 'sql' && language !== 'python') {
    return { error: '`language` must be one of "sparql", "sql", "python".' };
  }
  const code = typeof obj.code === 'string' ? obj.code : '';
  if (!code.trim()) {
    return { error: '`code` is required and must be a non-empty string.' };
  }
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : '';
  if (!rationale) {
    return { error: '`rationale` is required and must be a non-empty string.' };
  }
  return { language, code, rationale };
}

/**
 * Read the frontmatter of a single note and return it as JSON. No
 * approval gate — this is read-only and symmetric with `read_note`.
 */
async function runFetchProperties(ctx: ToolContext, input: unknown): Promise<string> {
  const { relative_path } = input as { relative_path: string };
  if (typeof relative_path !== 'string' || !relative_path) {
    throw new Error('relative_path is required');
  }
  const content = await fs.readFile(ctx.rootPath, relative_path);
  const props = readFrontmatterProperties(content);
  return JSON.stringify(props, null, 2);
}

/**
 * Trust-principle parity with `propose_notes` / `propose_sources`:
 * `set_properties` does NOT write. It validates the bundle, emits a
 * `ConversationPropertyDraft` for inline user review, and returns
 * "drafted." The IPC handler for `CONVERSATION_FILE_PROPERTY_DRAFT`
 * applies the writes once the user approves.
 */
function runSetProperties(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onPropertyDraft) {
    return {
      content: 'set_properties is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'set_properties requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseSetPropertiesInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  const draft: ConversationPropertyDraft = {
    draftId: `propdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    updates: parsed.updates,
    createdAt: new Date().toISOString(),
  };
  callbacks.onPropertyDraft(draft);

  const summary = parsed.updates
    .map((u) => `${u.relativePath} (${Object.keys(u.properties).length} key${Object.keys(u.properties).length === 1 ? '' : 's'})`)
    .join(', ');
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      updateCount: parsed.updates.length,
      proposed: parsed.updates.map((u) => ({
        relativePath: u.relativePath,
        keys: Object.keys(u.properties),
      })),
      // Same anti-loop hint as propose_notes / propose_sources — the
      // model has historically retried draft-emitting tools when it
      // didn't see a "successful" write effect in the result.
      hint:
        'STOP. The property bundle has been queued for user review. End ' +
        'this turn with ONE short acknowledgement sentence ' +
        '("Proposed N property update(s) for review.") and DO NOT call ' +
        'set_properties again in this turn. DO NOT call any other tool. ' +
        'DO NOT repeat the property values inline.',
    }) + `\n\n(queued property draft: ${summary})`,
    isError: false,
  };
}

function parseSetPropertiesInput(
  input: unknown,
): SetPropertiesInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'set_properties input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  if (!Array.isArray(obj.updates) || obj.updates.length === 0) {
    return { error: '`updates` must be a non-empty array. If you have no property '
      + 'changes to propose, reply to the user in plain text instead.' };
  }
  const updates: PropertyUpdate[] = [];
  for (const raw of obj.updates) {
    if (!raw || typeof raw !== 'object') {
      return { error: 'Each update entry must be an object.' };
    }
    const u = raw as Record<string, unknown>;
    const relativePath = typeof u.relativePath === 'string' ? u.relativePath.trim() : '';
    if (!relativePath) {
      return { error: 'Each update entry must include a non-empty `relativePath`.' };
    }
    if (relativePath.includes('..')) {
      return { error: `relativePath must not contain '..': ${relativePath}` };
    }
    if (!u.properties || typeof u.properties !== 'object' || Array.isArray(u.properties)) {
      return { error: `update for ${relativePath}: \`properties\` must be a non-array object.` };
    }
    const props = u.properties as Record<string, unknown>;
    if (Object.keys(props).length === 0) {
      return { error: `update for ${relativePath}: \`properties\` must include at least one key.` };
    }
    // Validate each value can round-trip through YAML. We accept the
    // loose PropertyValue shape (scalars, arrays, nested objects, null);
    // anything outside that means the model sent something exotic
    // (undefined, function, bigint) — reject early so the user doesn't
    // approve a no-op patch.
    const sanitized: PropertyPatch = {};
    for (const [k, v] of Object.entries(props)) {
      if (!isPropertyValue(v)) {
        return { error: `update for ${relativePath}: value for key "${k}" is not a YAML-encodable scalar/array/object/null.` };
      }
      sanitized[k] = v;
    }
    updates.push({ relativePath, properties: sanitized });
  }
  return { note, updates };
}

/**
 * Trust-principle parity with `set_properties`, for sources (#103):
 * `propose_source_properties` does NOT write. It validates the proposal, emits
 * a `ConversationSourcePropertyDraft` for inline review, and returns "drafted."
 * The `CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT` handler upserts the predicates
 * once the user approves.
 */
function runProposeSourceProperties(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onSourcePropertyDraft) {
    return {
      content: 'propose_source_properties is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'propose_source_properties requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseProposeSourcePropertiesInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  const draft: ConversationSourcePropertyDraft = {
    draftId: `srcpropdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    sourceId: parsed.sourceId,
    abstract: parsed.abstract,
    tldr: parsed.tldr,
    createdAt: new Date().toISOString(),
  };
  callbacks.onSourcePropertyDraft(draft);

  const proposed = [parsed.abstract ? 'abstract' : null, parsed.tldr ? 'tldr' : null]
    .filter(Boolean)
    .join(' + ');
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      sourceId: parsed.sourceId,
      proposed: { abstract: !!parsed.abstract, tldr: !!parsed.tldr },
      // Same anti-loop hint as the other draft-emitting tools.
      hint:
        'STOP. The source summary has been queued for user review. End this ' +
        'turn with ONE short acknowledgement sentence and DO NOT call ' +
        'propose_source_properties again. DO NOT call any other tool. DO NOT ' +
        'repeat the abstract/tldr text inline.',
    }) + `\n\n(queued source-property draft for ${parsed.sourceId}: ${proposed})`,
    isError: false,
  };
}

function parseProposeSourcePropertiesInput(
  input: unknown,
): ProposeSourcePropertiesInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_source_properties input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  const sourceId = typeof obj.sourceId === 'string' ? obj.sourceId.trim() : '';
  if (!sourceId) return { error: '`sourceId` is required and must be a non-empty string.' };
  const abstract = typeof obj.abstract === 'string' ? obj.abstract.trim() : '';
  const tldr = typeof obj.tldr === 'string' ? obj.tldr.trim() : '';
  if (!abstract && !tldr) {
    return { error: 'Provide at least one of `abstract` or `tldr`.' };
  }
  const out: ProposeSourcePropertiesInput = { note, sourceId };
  if (abstract) out.abstract = abstract;
  if (tldr) out.tldr = tldr;
  return out;
}

/**
 * Trust-principle parity with the other draft tools (#104):
 * `propose_claims` does NOT write. It reads the source body, resolves each
 * quote to an excerpt id + char range, emits a `ConversationClaimsDraft` for
 * inline review, and returns "drafted." The
 * `CONVERSATION_FILE_CLAIMS_DRAFT` handler files claim notes + excerpt nodes
 * through the approval engine once the user approves.
 */
async function runProposeClaims(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onClaimsDraft) {
    return { content: 'propose_claims is only available in conversation contexts.', isError: true };
  }
  if (!ctx.conversationId) {
    return { content: 'propose_claims requires a bound conversation id.', isError: true };
  }
  const parsed = parseProposeClaimsInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  // Read the source body so each quote can be anchored by char range. A
  // missing body isn't fatal — claims still file, just quote-anchored.
  let body = '';
  try {
    body = await fs.readFile(ctx.rootPath, `.minerva/sources/${parsed.sourceId}/body.md`);
  } catch { /* no body.md — offsets stay unset */ }

  const claims: DraftClaim[] = parsed.claims.map((c) => {
    const quote = c.quote.trim();
    const idx = body ? body.indexOf(quote) : -1;
    const found = idx >= 0;
    return {
      text: c.text.trim(),
      kind: c.kind,
      quote,
      confidence: c.confidence,
      excerptId: excerptIdFor(parsed.sourceId, quote),
      quoteFound: found,
      ...(found ? { charStart: idx, charEnd: idx + quote.length } : {}),
    };
  });

  const draft: ConversationClaimsDraft = {
    draftId: `claimsdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    sourceId: parsed.sourceId,
    claims,
    createdAt: new Date().toISOString(),
  };
  callbacks.onClaimsDraft(draft);

  const approx = claims.filter((c) => !c.quoteFound).length;
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      sourceId: parsed.sourceId,
      claimCount: claims.length,
      quotesNotAnchored: approx,
      hint:
        'STOP. The claims have been queued for user review. End this turn with ' +
        'ONE short acknowledgement sentence and DO NOT call propose_claims ' +
        'again. DO NOT call any other tool. DO NOT repeat the claims inline.',
    }) + `\n\n(queued ${claims.length} claim(s) for ${parsed.sourceId}${approx ? `, ${approx} quote(s) not verbatim` : ''})`,
    isError: false,
  };
}

function parseProposeClaimsInput(
  input: unknown,
): ProposeClaimsInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_claims input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  const sourceId = typeof obj.sourceId === 'string' ? obj.sourceId.trim() : '';
  if (!sourceId) return { error: '`sourceId` is required and must be a non-empty string.' };
  if (!Array.isArray(obj.claims) || obj.claims.length === 0) {
    return { error: '`claims` must be a non-empty array. If you have no claims to '
      + 'extract, reply to the user in plain text instead.' };
  }
  const claims: ProposeClaimsInput['claims'] = [];
  for (const raw of obj.claims) {
    if (!raw || typeof raw !== 'object') return { error: 'Each claim must be an object.' };
    const c = raw as Record<string, unknown>;
    const text = typeof c.text === 'string' ? c.text.trim() : '';
    if (!text) return { error: 'Each claim needs a non-empty `text`.' };
    const quote = typeof c.quote === 'string' ? c.quote.trim() : '';
    if (!quote) return { error: `claim "${text.slice(0, 40)}": a non-empty \`quote\` is required.` };
    const kind = typeof c.kind === 'string' ? c.kind : '';
    if (!(CLAIM_KINDS as readonly string[]).includes(kind)) {
      return { error: `claim "${text.slice(0, 40)}": \`kind\` must be one of ${CLAIM_KINDS.join(', ')}.` };
    }
    const confidence = typeof c.confidence === 'number' ? c.confidence : NaN;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return { error: `claim "${text.slice(0, 40)}": \`confidence\` must be a number in [0, 1].` };
    }
    claims.push({ text, kind: kind as ClaimKind, quote, confidence });
  }
  return { note, sourceId, claims };
}

function isPropertyValue(v: unknown): v is PropertyValue {
  if (v === null) return true;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.every(isPropertyValue);
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).every(isPropertyValue);
  }
  return false;
}
