import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';

describe('reorganization skills (#915)', () => {
  it('ships the reorg skills in the Analysis menu, grouped + propose-only', async () => {
    // Point at a non-existent user dir so only stock skills load.
    const cat = await loadSkillCatalog(path.join(os.tmpdir(), 'minerva-no-user-skills-915'));
    expect(cat.errors).toEqual([]);
    const byName = new Map(cat.skills.map((s) => [s.name, s]));

    for (const name of ['Reorganize by Topic', 'Tidy Filenames']) {
      const s = byName.get(name);
      expect(s, `${name} should ship as a stock skill`).toBeDefined();
      expect(s!.source).toBe('stock');
      expect(s!.menu).toBe('Analysis');
      expect(s!.group).toBe('Organization');
      expect(s!.outputMode).toBe('openConversation');
      // Drives the batch review substrate (#914) — and only that.
      expect(s!.body).toContain('propose_reorganization');
      // Trust principle: the skill proposes, never applies. It must not claim a
      // capability to move files directly.
      expect(s!.body.toLowerCase()).toContain('propose, never apply');
    }
  });
});
