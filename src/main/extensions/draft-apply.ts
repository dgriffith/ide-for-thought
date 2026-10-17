/**
 * Doing what the user chose with a drafted extension (#2652). Each is run by
 * main when the user presses a button on the draft's card, on the copy main
 * kept when the tool ran (`CheckedExtensionDraft`). Installing a plugin is
 * `lifecycle.ts`'s `installPluginFromDraft`, through `changePlugins`.
 *
 * Saving a skill writes it to a scratch folder and imports it from there, so
 * it is checked exactly as Settings → Skills → Import checks a file: parsed,
 * refused if its id is taken, never over an existing file.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CheckedExtensionDraft } from './draft-check';
import { writeDraftFiles } from '../plugins/draft-files';
import { importSkillFromPath } from '../skills/manage';
import { userSkillsDir } from '../skills/loader';

/** What to import or write for a skill: its `.md`, or its folder. */
function skillEntry(draft: CheckedExtensionDraft): { name: string; folder: boolean } {
  const [first, second] = draft.files[0]!.path.split('/');
  return { name: first!, folder: second !== undefined };
}

/** Save a drafted skill into `~/.minerva/skills/` (`dir` for tests). Answers where it went. */
export async function saveSkillDraft(draft: CheckedExtensionDraft, dir: string = userSkillsDir()): Promise<string> {
  if (draft.kind !== 'skill') throw new Error('Only a skill can be saved to your skills.');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-skill-draft-'));
  try {
    const staged = path.join(scratch, 'draft');
    await writeDraftFiles(staged, draft.files);
    const entry = skillEntry(draft);
    await importSkillFromPath(path.join(staged, entry.name), dir);
    return path.join(dir, entry.name);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Write a draft into `parent`, a folder the user picked: a plugin as
 * `<parent>/<id>/`, a skill as its `.md` or its folder. Never over anything
 * that's there. Answers what it wrote.
 */
export async function saveDraftToFolder(draft: CheckedExtensionDraft, parent: string): Promise<string> {
  try {
    if (draft.kind === 'plugin') {
      const folder = path.join(parent, draft.id);
      await writeDraftFiles(folder, draft.files);
      return folder;
    }
    const entry = skillEntry(draft);
    const target = path.join(parent, entry.name);
    if (entry.folder) {
      await writeDraftFiles(target, [{ path: 'SKILL.md', content: draft.files[0]!.content }]);
    } else {
      await fs.writeFile(target, draft.files[0]!.content, { flag: 'wx' });
    }
    return target;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`${path.join(parent, draft.kind === 'plugin' ? draft.id : skillEntry(draft).name)} already exists; pick another folder.`, { cause: e });
    }
    throw e;
  }
}
