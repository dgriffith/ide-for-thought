import { ipcMain, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import * as notebaseFs from '../notebase/fs';
import { writeAndReindex } from '../notebase/write-pipeline';
import { generateBibliography } from '../bibliography/generate';
import {
  getBibliographyStyleId,
  setBibliographyStyleId,
} from '../project-config';
import { DEFAULT_STYLE } from '../publish/csl/assets';
import {
  loadUserStyles,
  loadUserLocales,
  getMergedStyles,
  isValidCslStyle,
  isValidCslLocale,
  extractStyleTitle,
  deriveStyleId,
  deriveLocaleId,
  USER_STYLES_DIR,
  USER_LOCALES_DIR,
} from '../publish/csl/user-assets';
import { renderInlineCitations, type InlineCiteRequest, type InlineCiteResponse } from '../citations/render-inline';
import { rootPathFromEvent, winFromEvent, withRootPath, withRootPathOr, hooks } from './helpers';

export function registerBibliography(): void {
  // Bibliography (#113)
  ipcMain.handle(Channels.BIBLIOGRAPHY_LIST_STYLES, async (e) => {
    const rootPath = rootPathFromEvent(e);
    // Settings dialog opens before any project is loaded in some flows;
    // fall back to the bundled set so the picker isn't empty.
    const merged = rootPath
      ? await getMergedStyles(rootPath)
      : await getMergedStyles('');
    return Object.keys(merged.styles).map((id) => ({
      id,
      label: merged.labels[id] ?? id,
      isUser: merged.userIds.has(id),
    }));
  });
  ipcMain.handle(Channels.BIBLIOGRAPHY_GET_STYLE, withRootPathOr(DEFAULT_STYLE, (rootPath) => {
    return getBibliographyStyleId(rootPath) ?? DEFAULT_STYLE;
  }));
  ipcMain.handle(Channels.BIBLIOGRAPHY_SET_STYLE, withRootPath(async (rootPath, styleId: string) => {
    const merged = await getMergedStyles(rootPath);
    if (!Object.prototype.hasOwnProperty.call(merged.styles, styleId)) {
      throw new Error(`Unknown CSL style: ${styleId}`);
    }
    setBibliographyStyleId(rootPath, styleId);
  }));

  // User-imported CSL styles + locales (#302)
  type UserStyleInfo = { id: string; label: string; filePath: string };
  ipcMain.handle(Channels.CSL_LIST_USER_STYLES, withRootPathOr<[], UserStyleInfo[] | Promise<UserStyleInfo[]>>([], async (rootPath) => {
    return (await loadUserStyles(rootPath)).map((s) => ({
      id: s.id,
      label: s.label,
      filePath: s.filePath,
    }));
  }));
  type UserLocaleInfo = { id: string; filePath: string };
  ipcMain.handle(Channels.CSL_LIST_USER_LOCALES, withRootPathOr<[], UserLocaleInfo[] | Promise<UserLocaleInfo[]>>([], async (rootPath) => {
    return (await loadUserLocales(rootPath)).map((l) => ({
      id: l.id,
      filePath: l.filePath,
    }));
  }));
  ipcMain.handle(Channels.CSL_IMPORT_STYLE, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const win = winFromEvent(e);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'CSL style', extensions: ['csl', 'xml'] }],
      title: 'Import CSL style',
      buttonLabel: 'Import',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const sourcePath = result.filePaths[0]!;
    const xml = await fs.readFile(sourcePath, 'utf-8');
    if (!isValidCslStyle(xml)) {
      throw new Error('File is not a valid CSL style (missing <style> element with the CSL namespace).');
    }
    const id = deriveStyleId(path.basename(sourcePath));
    if (!id) throw new Error('Could not derive a style id from the filename.');
    const destDir = path.join(rootPath, USER_STYLES_DIR);
    await fs.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, `${id}.csl`);
    await fs.writeFile(destPath, xml, 'utf-8');
    return { id, label: extractStyleTitle(xml) ?? id, filePath: destPath };
  });
  ipcMain.handle(Channels.CSL_IMPORT_LOCALE, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const win = winFromEvent(e);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'CSL locale', extensions: ['xml'] }],
      title: 'Import CSL locale',
      buttonLabel: 'Import',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const sourcePath = result.filePaths[0]!;
    const xml = await fs.readFile(sourcePath, 'utf-8');
    if (!isValidCslLocale(xml)) {
      throw new Error('File is not a valid CSL locale (missing <locale> element with the CSL namespace).');
    }
    const id = deriveLocaleId(path.basename(sourcePath));
    if (!id) throw new Error('Could not derive a locale id from the filename.');
    const destDir = path.join(rootPath, USER_LOCALES_DIR);
    await fs.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, `${id}.xml`);
    await fs.writeFile(destPath, xml, 'utf-8');
    return { id, filePath: destPath };
  });
  ipcMain.handle(Channels.CSL_REMOVE_STYLE, withRootPath(async (rootPath, id: string) => {
    if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('Invalid style id.');
    const target = path.join(rootPath, USER_STYLES_DIR, `${id}.csl`);
    await fs.unlink(target).catch(() => undefined);
  }));
  ipcMain.handle(Channels.CSL_REMOVE_LOCALE, withRootPath(async (rootPath, id: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid locale id.');
    const target = path.join(rootPath, USER_LOCALES_DIR, `${id}.xml`);
    await fs.unlink(target).catch(() => undefined);
  }));
  ipcMain.handle(Channels.CITATION_RENDER_INLINE, withRootPathOr<[InlineCiteRequest[]], InlineCiteResponse | Promise<InlineCiteResponse>>({ markers: [], bibliography: null, missing: [], styleId: DEFAULT_STYLE }, async (rootPath, refs: InlineCiteRequest[]) => {
    return await renderInlineCitations(rootPath, refs ?? []);
  }));

  ipcMain.handle(Channels.BIBLIOGRAPHY_GENERATE, withRootPath(async (rootPath, relativePath: string) => {
    const original = await notebaseFs.readFile(rootPath, relativePath);
    const result = await generateBibliography(rootPath, original);
    if (result.changed) {
      // 6-step pipeline keeps graph + search + open editors in sync
      // with on-disk content, just like a manual save.
      await writeAndReindex(rootPath, relativePath, result.content, hooks);
    }
    return {
      entriesCount: result.entriesCount,
      missingIds: result.missingIds,
      changed: result.changed,
      styleId: result.styleId,
    };
  }));
}
