import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';

describe('Find Outliers skill (data-analysis cluster)', () => {
  it('ships in Analysis ▸ Data, SQL-first, propose-only, emitting sql + vega-lite embeds', async () => {
    const cat = await loadSkillCatalog(path.join(os.tmpdir(), 'minerva-no-user-skills-outliers'));
    expect(cat.errors).toEqual([]);

    const s = cat.skills.find((sk) => sk.name === 'Find Outliers');
    expect(s, 'Find Outliers should ship as a stock skill').toBeDefined();
    expect(s!.source).toBe('stock');
    expect(s!.menu).toBe('Analysis');
    expect(s!.group).toBe('Data');
    expect(s!.outputMode).toBe('openConversation');
    expect(s!.context ?? []).toEqual([]); // whole-vault

    expect(s!.body).toContain('describe_tables');
    expect(s!.body).toContain('query_sql');
    expect(s!.body).toContain('propose_notes');
    expect(s!.body).toContain('quantile_cont'); // robust IQR method
    expect(s!.body).toContain('boxplot');
    expect(s!.body).toContain('vega-lite');
    expect(s!.body.toLowerCase()).toContain('propose, never apply');
  });
});
