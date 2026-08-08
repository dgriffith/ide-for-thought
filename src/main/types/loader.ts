/**
 * Type-registry loader (#1062). Stock types ship bundled via a Vite glob
 * (mirroring skills/loader.ts); user types live in-tree at
 * `<rootPath>/.minerva/types/*.md` so they travel with the library (decision 1
 * in docs/vision/objects.md). Unlike skills, the catalog is PER-PROJECT — the
 * user portion is a property of this thoughtbase's vocabulary, not the machine.
 *
 * Loading is additive, and an in-tree file of the same id OVERRIDES the stock
 * type it shadows — that's how a thoughtbase customizes Book or Meeting
 * (add a property, change the icon) without forking the bundle. The override is
 * a full local copy, marked `overridesStock` so the UI can offer "revert to
 * stock": deleting the in-tree file restores the bundled definition, because
 * the stock set is still loaded underneath. The id is what carries the override,
 * and `classLocalName` derives from the id, so a customized Book keeps its
 * `types:Book` class and every existing instance stays valid.
 *
 * Two ids colliding within the SAME source is still an error (a duplicate stock
 * id, or two user files claiming one id) — those are mistakes, not overrides.
 *
 * Process / test note (#1630): the stock set is a build-time module-global — the
 * `?raw` glob below, one immutable copy per process. Crucially, unlike the tool
 * registry's *mutable* module-global `Map` (`shared/tools/registry.ts`, whose
 * doc explains why tests must reset it), `loadTypeCatalog` returns a FRESH
 * catalog on every call, held on the per-project `GraphState`
 * (`state.typeCatalog`) — there is no shared mutable singleton here. So a test
 * gets isolation just by loading against its own temp `rootPath`; there's no
 * process-global catalog state to clear between tests.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type TypeCatalog,
  type TypeDef,
  type TypeLoadError,
} from '../../shared/objects/type-def';
import { parseType } from './parse';

// Stock types inlined into the main bundle at build time (query:'?raw').
const STOCK_RAW = import.meta.glob('./stock/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Reserved in-tree home for user-authored types. */
export function userTypesDir(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'types');
}

function loadStock(): { types: TypeDef[]; errors: TypeLoadError[] } {
  const types: TypeDef[] = [];
  const errors: TypeLoadError[] = [];
  for (const [key, content] of Object.entries(STOCK_RAW)) {
    const r = parseType(content, 'stock', key);
    if (r.type) types.push(r.type);
    else for (const message of r.errors) errors.push({ source: 'stock', filePath: key, label: r.label, message });
  }
  return { types, errors };
}

async function loadUser(dir: string): Promise<{ types: TypeDef[]; errors: TypeLoadError[] }> {
  const types: TypeDef[] = [];
  const errors: TypeLoadError[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { types, errors };
    throw e;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.md')) continue;
    const fp = path.join(dir, ent.name);
    const r = parseType(await fs.readFile(fp, 'utf-8'), 'user', fp);
    if (r.type) types.push(r.type);
    else for (const message of r.errors) errors.push({ source: 'user', filePath: fp, label: r.label, message });
  }
  return { types, errors };
}

/**
 * Build the per-project type catalog. Stock loads first and wins id collisions;
 * a user type colliding with stock (or an earlier user type) is rejected with an
 * error. `rootPath` locates the in-tree user types.
 */
export async function loadTypeCatalog(rootPath: string): Promise<TypeCatalog> {
  const stock = loadStock();
  const user = await loadUser(userTypesDir(rootPath));

  const byId = new Map<string, TypeDef>();
  const errors: TypeLoadError[] = [...stock.errors, ...user.errors];

  for (const t of stock.types) {
    if (byId.has(t.id)) {
      errors.push({ source: 'stock', filePath: t.filePath, label: t.label, message: `duplicate stock type id "${t.id}"` });
      continue;
    }
    byId.set(t.id, t);
  }
  for (const t of user.types) {
    const existing = byId.get(t.id);
    if (existing && existing.source === 'stock') {
      // A local customization of a stock type — the in-tree file wins, and the
      // stock definition stays available underneath to revert to.
      byId.set(t.id, { ...t, overridesStock: true });
      continue;
    }
    if (existing) {
      // Two user files claiming the same id is a genuine mistake: there's no
      // "underneath" to fall back to, so first-loaded wins and we say so.
      errors.push({ source: 'user', filePath: t.filePath, label: t.label, message: `duplicate user type id "${t.id}"` });
      continue;
    }
    byId.set(t.id, t);
  }

  // Validate parent refs now that every type id is known (#1586). An unknown or
  // self parent is soft-flagged and cleared so nothing materializes a dangling
  // `rdfs:subClassOf`. (Cycles are left alone — SPARQL property paths handle
  // them; single inheritance keeps them rare.)
  for (const t of byId.values()) {
    if (!t.parent) continue;
    if (t.parent === t.id) {
      errors.push({ source: t.source, filePath: t.filePath, label: t.label, message: `a type can't be its own parent` });
      t.parent = undefined;
    } else if (!byId.has(t.parent)) {
      errors.push({ source: t.source, filePath: t.filePath, label: t.label, message: `parent type "${t.parent}" does not exist` });
      t.parent = undefined;
    }
  }

  return { types: [...byId.values()], errors };
}
