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
  /** Compute-related per-project settings (#373). */
  compute?: {
    /**
     * Has the user OK'd Python cell execution for this thoughtbase?
     * Trust is project-scoped — opening a different thoughtbase
     * prompts again. The flag is recorded once via the first-run
     * trust dialog; cancelling the dialog blocks execution and
     * leaves the flag unset.
     */
    pythonTrusted?: boolean;
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

/** Per-project Python trust flag (#373). Default false. */
export function getPythonTrust(rootPath: string): boolean {
  return readProjectConfig(rootPath).compute?.pythonTrusted === true;
}

export function setPythonTrust(rootPath: string, trusted: boolean): void {
  // Merge into the existing compute slice rather than overwriting it,
  // so a future `compute.<other>` field doesn't get clobbered.
  const existing = readProjectConfig(rootPath).compute ?? {};
  patchProjectConfig(rootPath, { compute: { ...existing, pythonTrusted: trusted } });
}
