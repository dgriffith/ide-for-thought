import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';

describe('Find Correlations skill (data-analysis cluster)', () => {
  it('ships in Analysis ▸ Data, SQL-first, propose-only, emitting sql + vega-lite embeds', async () => {
    // Point at a non-existent user dir so only stock skills load.
    const cat = await loadSkillCatalog(path.join(os.tmpdir(), 'minerva-no-user-skills-corr'));
    expect(cat.errors).toEqual([]);

    const s = cat.skills.find((sk) => sk.name === 'Find Correlations');
    expect(s, 'Find Correlations should ship as a stock skill').toBeDefined();
    expect(s!.source).toBe('stock');
    expect(s!.menu).toBe('Analysis');
    expect(s!.group).toBe('Data');
    expect(s!.outputMode).toBe('openConversation');
    // Whole-vault: no context requirement, so the item is always enabled and the
    // agent discovers tables itself.
    expect(s!.context ?? []).toEqual([]);

    // Uses the autonomous tabular tools, and files results as a note.
    expect(s!.body).toContain('describe_tables');
    expect(s!.body).toContain('query_sql');
    expect(s!.body).toContain('propose_notes');
    // Correlation via DuckDB + a live-bound chart in the output note.
    expect(s!.body).toContain('corr(');
    expect(s!.body).toContain('vega-lite');
    expect(s!.body).toContain('data');
    // Trust principle: proposes a note, never writes directly.
    expect(s!.body.toLowerCase()).toContain('propose, never apply');
  });
});
