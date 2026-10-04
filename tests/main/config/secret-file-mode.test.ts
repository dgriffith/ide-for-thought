/**
 * Every store that holds credentials is written owner-only (#2562).
 *
 * `writeJsonFileAtomic*` creates files with the process default (usually
 * 0644, world-readable) unless told otherwise. These are the stores whose
 * contents are credentials — encrypted at rest where the keychain allows, but
 * another local user still has no business reading them. Each write of each
 * must pass `mode: SECRET_FILE_MODE`; a new write to one that forgets fails here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', '..', '..', 'src', 'main');

/** module → the store it writes (for the failure message). */
const SECRET_STORE_WRITERS: Record<string, string> = {
  'project-config.ts': '.minerva/secrets.json (publish credentials)',
  'mcp-servers/config-store.ts': '~/.minerva/mcp-servers.json (server env: API keys)',
  'mcp-client/oauth/token-store.ts': 'userData/mcp-oauth-tokens.json',
  'llm/settings.ts': 'userData/llm-settings.json (provider API keys)',
  'clipper/clipper-config.ts': 'userData/clipper-config.json (shared secret)',
};

describe('credential stores are written 0600 (#2562)', () => {
  for (const [file, store] of Object.entries(SECRET_STORE_WRITERS)) {
    it(`${file} writes ${store} with SECRET_FILE_MODE`, () => {
      const src = fs.readFileSync(path.join(SRC, file), 'utf-8');
      const writes = src.match(/writeJsonFileAtomic(?:Sync)?\([^;]*\);/g) ?? [];
      expect(writes.length, `${file} no longer writes through writeJsonFileAtomic — update this test`).toBeGreaterThan(0);
      for (const w of writes) expect(w, `${file}: ${w}`).toContain('mode: SECRET_FILE_MODE');
    });
  }
});
