/**
 * Revision cause naming (#1158) — the "what did this?" column in the History
 * panel. The rule under test: a revision is named after the command the USER
 * ran (the skill, the menu action), not after the plumbing that wrote the file.
 */
import { describe, it, expect } from 'vitest';
import { describeProposalCause, describeRevisionCause } from '../../src/shared/history';

describe('describeProposalCause', () => {
  it('prefers the launching skill name over anything else', () => {
    expect(describeProposalCause({
      proposedBy: 'llm:conversation:conv-123',
      operationType: 'note_rewrite',
      skillName: 'Antithesize',
    })).toBe('Antithesize');
  });

  it('names Minerva\'s own built-in write paths as the user invoked them', () => {
    expect(describeProposalCause({ proposedBy: 'llm:auto-tag', operationType: 'note_rewrite' }))
      .toBe('Auto-tag');
    expect(describeProposalCause({ proposedBy: 'llm:auto-link', operationType: 'note_rewrite' }))
      .toBe('Auto-link');
    expect(describeProposalCause({ proposedBy: 'llm:auto-link-inbound', operationType: 'note_rewrite' }))
      .toBe('Auto-link (inbound)');
  });

  it('falls back to "Conversation" for a chat with no skill behind it', () => {
    expect(describeProposalCause({ proposedBy: 'llm:conversation:conv-9', operationType: 'note_rewrite' }))
      .toBe('Conversation');
  });

  it('names the fleet agent for an external proposer', () => {
    expect(describeProposalCause({ proposedBy: 'mcp:claude-code', operationType: 'new_claim' }))
      .toBe('claude-code');
    expect(describeProposalCause({ proposedBy: 'cli', operationType: 'new_claim' }))
      .toBe('CLI');
  });

  it('falls back to the operation when the proposer stamp says nothing useful', () => {
    expect(describeProposalCause({ proposedBy: '', operationType: 'note_rewrite' }))
      .toBe('Note rewritten');
    // An unrecognized stamp with an unrecognized operation still shows the
    // stamp rather than an empty cell.
    expect(describeProposalCause({ proposedBy: 'e2e', operationType: 'mystery' }))
      .toBe('e2e');
  });
});

describe('describeRevisionCause', () => {
  it('shows the recorded cause verbatim', () => {
    expect(describeRevisionCause({ origin: 'proposal', cause: 'Auto-tag' })).toBe('Auto-tag');
  });

  it('derives a label from the origin for revisions captured before causes existed', () => {
    expect(describeRevisionCause({ origin: 'edit' })).toBe('Edit');
    expect(describeRevisionCause({ origin: 'restore' })).toBe('Restored');
    expect(describeRevisionCause({ origin: 'proposal' })).toBe('Minerva AI');
  });
});
