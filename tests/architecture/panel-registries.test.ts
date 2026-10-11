/**
 * Panel shells iterate their registry (#2626, epic #2622). The left sidebar
 * (`sidebar/panels.ts`), the right sidebar (`right-sidebar/panels.ts`) and the
 * Settings dialog (`settings/sections.ts`)
 * used to name every panel in an `{#if active === '…'}` chain beside a table of
 * the same ids; a panel is now one registry entry, and the shell draws
 * whichever is active. This keeps a hand-written branch from coming back: a
 * shell may not compare its active id to a literal.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const SHELLS: Array<[shell: string, activeVar: string, registry: string]> = [
  ['src/renderer/lib/components/Sidebar.svelte', 'activePanel', 'src/renderer/lib/components/sidebar/panels.ts'],
  ['src/renderer/lib/components/RightSidebar.svelte', 'activePanel', 'src/renderer/lib/components/right-sidebar/panels.ts'],
  ['src/renderer/lib/components/SettingsDialog.svelte', 'activeTab', 'src/renderer/lib/components/settings/sections.ts'],
];

describe('panel shells dispatch through their registry (#2626)', () => {
  it.each(SHELLS)('%s never branches on a literal panel id', (shell, activeVar) => {
    const src = fs.readFileSync(path.join(ROOT, shell), 'utf8');
    const hits = [...src.matchAll(new RegExp(`\\b${activeVar}\\s*[!=]==\\s*['"][\\w-]+['"]`, 'g'))].map((m) => m[0]);
    expect(hits, `put the panel in its registry instead`).toEqual([]);
  });

  it.each(SHELLS)('%s draws from its registry', (shell, _v, registry) => {
    const src = fs.readFileSync(path.join(ROOT, shell), 'utf8');
    expect(src).toContain(`/${path.basename(registry, '.ts')}'`);
    expect(fs.existsSync(path.join(ROOT, registry))).toBe(true);
  });
});
