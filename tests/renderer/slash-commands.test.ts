import { describe, it, expect } from 'vitest';
import { slashQueryFromComposer, filterSlashCommands } from '../../src/renderer/lib/conversations/slash-commands';
import type { ThinkingToolInfo } from '../../src/shared/tools/types';

function info(over: Partial<ThinkingToolInfo>): ThinkingToolInfo {
  return {
    id: over.id ?? 'x',
    name: over.name ?? 'X',
    category: 'research',
    description: over.description ?? '',
    longDescription: '',
    context: [],
    outputMode: 'openConversation',
    ...over,
  };
}

describe('slashQueryFromComposer', () => {
  it('returns the lowercased query for a single leading slash-token', () => {
    expect(slashQueryFromComposer('/sum')).toBe('sum');
    expect(slashQueryFromComposer('/Steel')).toBe('steel');
    expect(slashQueryFromComposer('/')).toBe('');
    expect(slashQueryFromComposer('/find-counter')).toBe('find-counter');
  });

  it('returns null once the token ends or for non-command text', () => {
    expect(slashQueryFromComposer('/sum up the note')).toBeNull(); // has a space
    expect(slashQueryFromComposer('what is /foo')).toBeNull();     // not at start
    expect(slashQueryFromComposer('hello')).toBeNull();
    expect(slashQueryFromComposer('')).toBeNull();
    expect(slashQueryFromComposer('//')).toBeNull();
  });
});

describe('filterSlashCommands', () => {
  const items = [
    info({ id: 'research.steelman', name: 'Steelman', slashCommand: '/steelman', description: 'Strongest form' }),
    info({ id: 'research.find-primary-sources', name: 'Find Primary Sources', slashCommand: '/primary-sources', description: 'Trace to source' }),
    info({ id: 'learning.summarize', name: 'Summarize', slashCommand: '/summarize', description: 'TL;DR' }),
    info({ id: 'analysis.no-slash', name: 'No Slash', description: 'has no slashCommand' }), // excluded
    info({ id: 'research.extract', name: 'Extract Key Claims', slashCommand: '/claims', description: 'mine claims', scope: 'source' }), // excluded (source)
  ];

  it('lists every slash skill for an empty query, alpha by command key', () => {
    const out = filterSlashCommands(items, '');
    // command keys: primary-sources, steelman, summarize → that id order.
    expect(out.map((i) => i.id)).toEqual([
      'research.find-primary-sources', 'research.steelman', 'learning.summarize',
    ]);
  });

  it('ranks command-prefix matches first', () => {
    const out = filterSlashCommands(items, 's');
    // /steelman and /summarize start with "s"; /primary-sources only contains it.
    expect(out[0].slashCommand === '/steelman' || out[0].slashCommand === '/summarize').toBe(true);
    expect(out.map((i) => i.slashCommand)).toContain('/primary-sources');
    expect(out.indexOf(out.find((i) => i.slashCommand === '/primary-sources')!))
      .toBeGreaterThan(out.findIndex((i) => i.slashCommand!.startsWith('/s')));
  });

  it('matches on name when the command does not match', () => {
    const out = filterSlashCommands(items, 'strongest'); // only Steelman's description... name? no
    expect(out.length).toBe(0); // description isn't matched, name "Steelman" doesn't contain "strongest"
    const byName = filterSlashCommands(items, 'primary'); // name "Find Primary Sources"
    expect(byName.map((i) => i.id)).toContain('research.find-primary-sources');
  });

  it('excludes source-scoped skills and skills without a slashCommand', () => {
    const out = filterSlashCommands(items, '');
    expect(out.map((i) => i.id)).not.toContain('analysis.no-slash');
    expect(out.map((i) => i.id)).not.toContain('research.extract');
  });
});
