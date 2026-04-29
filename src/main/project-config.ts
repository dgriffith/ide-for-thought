/**
 * Per-project config (`.minerva/config.json`).
 *
 * The graph module already writes a `baseUri` here on first open; this
 * module is the home for everything else that's project-scoped — currently
 * the bibliography style. Read/write merge with whatever is on disk so
 * unrelated keys (notably `baseUri`) survive when one feature writes its
 * own slice.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ProjectConfigShape {
  baseUri?: string;
  bibliography?: {
    /** CSL style id; one of BUNDLED_STYLES keys. Falls back to APA. */
    styleId?: string;
  };
}

function configPath(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'config.json');
}

export function readProjectConfig(rootPath: string): ProjectConfigShape {
  try {
    const raw = fs.readFileSync(configPath(rootPath), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    return {};
  }
}

/**
 * Merge `patch` into the on-disk config. Top-level keys are replaced
 * wholesale; this is intentional — none of the current consumers want
 * a deep merge, and a shallow one is easy to reason about.
 */
export function patchProjectConfig(rootPath: string, patch: ProjectConfigShape): void {
  const existing = readProjectConfig(rootPath);
  const next: ProjectConfigShape = { ...existing, ...patch };
  fs.mkdirSync(path.dirname(configPath(rootPath)), { recursive: true });
  fs.writeFileSync(configPath(rootPath), JSON.stringify(next, null, 2), 'utf-8');
}

export function getBibliographyStyleId(rootPath: string): string | null {
  return readProjectConfig(rootPath).bibliography?.styleId ?? null;
}

export function setBibliographyStyleId(rootPath: string, styleId: string): void {
  patchProjectConfig(rootPath, { bibliography: { styleId } });
}
