import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';

describe('Generate Visualizations skill (data-analysis cluster)', () => {
  it('ships in Analysis ▸ Data, SQL-first, propose-only, emitting data.sql-bound vega-lite', async () => {
    const cat = await loadSkillCatalog(path.join(os.tmpdir(), 'minerva-no-user-skills-viz'));
    expect(cat.errors).toEqual([]);

    const s = cat.skills.find((sk) => sk.name === 'Generate Visualizations');
    expect(s, 'Generate Visualizations should ship as a stock skill').toBeDefined();
    expect(s!.source).toBe('stock');
    expect(s!.menu).toBe('Analysis');
    expect(s!.group).toBe('Data');
    expect(s!.outputMode).toBe('openConversation');
    expect(s!.context ?? []).toEqual([]); // whole-vault

    expect(s!.body).toContain('describe_tables');
    expect(s!.body).toContain('query_sql');
    expect(s!.body).toContain('propose_notes');
    expect(s!.body).toContain('vega-lite');
    // Charts bind live to the data via SQL, and the body carries chart-choice guidance.
    expect(s!.body).toContain('data');
    expect(s!.body.toLowerCase()).toContain('histogram');
    expect(s!.body.toLowerCase()).toContain('propose, never apply');
  });
});
