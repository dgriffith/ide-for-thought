/**
 * The inspection catalog — one declaration per health check (#1792).
 *
 * `graph/health-checks.ts` owns how each check is COMPUTED; this owns what each
 * one is called, what it's for, and whether the user is offered a switch for it.
 * Kept in `shared/` because both ends need it: main filters the run by the
 * enabled set, and the settings panel renders from the same list, so a check
 * can't drift out of the UI or gain a toggle that controls nothing.
 *
 * ## Hidden checks
 *
 * The argument-map checks — unsupported claims, missing warrants and backing,
 * contradictions — are part of the thought-ontology work that isn't user-facing
 * yet. They are marked `hidden` so the settings panel doesn't advertise a
 * feature the docs don't describe. Hidden is about VISIBILITY, not behaviour:
 * they still run, exactly as before, because a thoughtbase that has mined
 * claims is getting real findings from them today and silently dropping those
 * would be a feature removal wearing a settings change's clothes. When the
 * argument map ships to users, drop the flag and they appear with the rest.
 */

export type InspectionGroup = 'notes' | 'links' | 'sources' | 'arguments';

export interface InspectionDef {
  /** Matches `Inspection.type` from the engine. */
  type: string;
  label: string;
  /** One line, in the user's terms — what the check looks for and why. */
  description: string;
  group: InspectionGroup;
  /** Off in the settings list until the argument map is a user-facing feature. */
  hidden?: boolean;
}

export const INSPECTION_GROUP_LABELS: Record<InspectionGroup, string> = {
  notes: 'Notes',
  links: 'Links',
  sources: 'Sources',
  arguments: 'Arguments',
};

export const INSPECTIONS: readonly InspectionDef[] = [
  // ── Notes ────────────────────────────────────────────────────────────────
  {
    type: 'stale_note',
    label: 'Stale notes',
    description: "Notes you haven't touched in a while, in case they've quietly gone out of date.",
    group: 'notes',
  },

  // ── Links ────────────────────────────────────────────────────────────────
  {
    type: 'broken_note_link',
    label: 'Broken note links',
    description: 'Wiki-links pointing at a note that doesn\'t exist — usually a rename or a typo.',
    group: 'links',
  },
  {
    type: 'broken_anchor_link',
    label: 'Broken heading links',
    description: 'Links to a specific heading or block that has since been renamed or removed.',
    group: 'links',
  },
  {
    type: 'broken_cite_quote',
    label: 'Broken citations and quotes',
    description: 'A cite or quote link whose source or excerpt is no longer in the thoughtbase.',
    group: 'links',
  },

  // ── Sources ──────────────────────────────────────────────────────────────
  {
    type: 'source_missing_metadata',
    label: 'Sources missing details',
    description: 'Sources with no author, title, or date — the fields a citation needs.',
    group: 'sources',
  },
  {
    type: 'invalid_doi',
    label: 'Malformed DOIs',
    description: "A DOI that isn't shaped like one, so it won't resolve or look up.",
    group: 'sources',
  },
  {
    type: 'source_duplicate_doi',
    label: 'Duplicate sources',
    description: 'Two sources with the same DOI or address — likely the same thing ingested twice.',
    group: 'sources',
  },
  {
    type: 'source_cited_unread',
    label: 'Cited but unread',
    description: "Sources you've cited without marking them read.",
    group: 'sources',
  },
  {
    type: 'stub_aged',
    label: 'Long-unresolved stubs',
    description: 'Source stubs that have sat unfilled for a while.',
    group: 'sources',
  },

  // ── Arguments (hidden — see the module comment) ───────────────────────────
  {
    type: 'unsupported_claim',
    label: 'Unsupported claims',
    description: 'Claims with nothing offered in support of them.',
    group: 'arguments',
    hidden: true,
  },
  {
    type: 'missing_warrant',
    label: 'Missing warrants',
    description: "Grounds that don't say why they support the claim.",
    group: 'arguments',
    hidden: true,
  },
  {
    type: 'missing_backing',
    label: 'Missing backing',
    description: 'Warrants with nothing standing behind them.',
    group: 'arguments',
    hidden: true,
  },
  {
    type: 'contradiction',
    label: 'Contradictions',
    description: 'Claims recorded as contradicting each other.',
    group: 'arguments',
    hidden: true,
  },
] as const;

/** The checks the settings panel offers — everything not withheld. */
export function visibleInspections(): InspectionDef[] {
  return INSPECTIONS.filter((i) => !i.hidden);
}

/**
 * `source_duplicate_doi` and `source_duplicate_uri` are two shapes of one
 * finding and one user-facing switch; the engine emits both types, so the
 * toggle has to cover the pair.
 */
const TYPE_ALIASES: Record<string, string> = {
  source_duplicate_uri: 'source_duplicate_doi',
};

/** Which catalog entry an emitted inspection belongs to. */
export function catalogTypeFor(emittedType: string): string {
  return TYPE_ALIASES[emittedType] ?? emittedType;
}

// ── Settings shape ─────────────────────────────────────────────────────────
// The TYPE and the enabled-predicate live here, not beside the loader, so the
// engine can read a setting without importing anything Electron-flavoured.
// (Learned the hard way: an `import { app } from 'electron'` reachable from a
// widely-imported module breaks every test suite that touches it.)

export interface InspectionSettings {
  /** Inspection types the user has switched off. Everything else runs. */
  disabled: string[];
  /** Days before an untouched note is called stale. */
  staleDays: number;
  /** Days before an unresolved source stub is called long-unresolved. */
  stubDays: number;
}

export const DEFAULT_INSPECTION_SETTINGS: InspectionSettings = {
  disabled: [],
  staleDays: 30,
  stubDays: 30,
};

/**
 * Is this check switched on? Hidden checks (the argument map) always are —
 * they're absent from the settings panel, so nothing could have turned them
 * off, and treating an unknown id as disabled would silently kill a check the
 * moment someone renamed one.
 */
export function isInspectionEnabled(type: string, settings: InspectionSettings): boolean {
  const def = INSPECTIONS.find((i) => i.type === type);
  if (def?.hidden) return true;
  return !settings.disabled.includes(type);
}
