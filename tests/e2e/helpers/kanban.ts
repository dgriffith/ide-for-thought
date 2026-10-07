/**
 * Shared steps for the Kanban specs (#2602, #2603, #2614, #2605): seed stock
 * Project notes, open the Project view as a board, find cards and columns,
 * and drag a card onto a column with the pointer.
 *
 * The drag is pointer events end to end (`card-drag.ts`), not HTML5
 * drag-and-drop — a drag starts after 5px of travel, so the move is stepped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

/** A project's title and its `status`, or null to leave `status` out. */
export type SeedProject = [title: string, status: string | null];

/** The default note text: `type: project`, the status if any, and a heading. */
export const projectNote = (title: string, status: string | null): string =>
  `---\ntype: project\n${status ? `status: ${status}\n` : ''}---\n# ${title}\n`;

/** Write each project to `projects/<title>.md`; returns the path for a title. */
export function seedProjects(
  dir: string,
  projects: readonly SeedProject[],
  text: (title: string, status: string | null) => string = projectNote,
): (title: string) => string {
  const fileOf = (title: string) => path.join(dir, 'projects', `${title}.md`);
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  for (const [title, status] of projects) fs.writeFileSync(fileOf(title), text(title, status));
  return fileOf;
}

export interface Board {
  board: Locator;
  /** A card by its title, wherever it is. */
  cardFor(title: string): Locator;
  /** A card by its title, only if it's in the column whose value is `value` (`""` = No value). */
  inColumn(value: string, title: string): Locator;
  /** A column by its value (`""` = No value). */
  column(value: string): Locator;
}

export function boardOf(win: Page): Board {
  const board = win.locator('.kb-board');
  const column = (value: string) => board.locator(`section.kb-column[data-column-value="${value}"]`);
  return {
    board,
    column,
    cardFor: (title) => board.locator('[data-kanban-card]', { hasText: title }),
    inColumn: (value, title) => column(value).locator('[data-kanban-card]', { hasText: title }),
  };
}

/** From the Objects panel, open the Project view on its Kanban tab and wait for `cards` cards. */
export async function openProjectBoard(win: Page, cards: number): Promise<Board> {
  await win.locator('.panel-tab[title="Objects"]').first().click();
  await win.getByRole('button', { name: 'Open Project view' }).click({ force: true });
  await win.getByRole('tab', { name: 'Kanban' }).click();
  const b = boardOf(win);
  await expect(b.board.locator('[data-kanban-card]')).toHaveCount(cards, { timeout: 15_000 });
  return b;
}

/**
 * Drag the card titled `title` onto the column whose value is `value` with
 * the pointer. `whileOver` runs with the pointer held over the column, before
 * the drop — for asserting the drag's feedback.
 */
export async function dragCardToColumn(
  win: Page,
  b: Board,
  title: string,
  value: string,
  whileOver?: () => Promise<void>,
): Promise<void> {
  const from = await b.cardFor(title).boundingBox();
  const to = await b.column(value).boundingBox();
  if (!from || !to) throw new Error(`no layout for the ${title} card or the ${value} column`);
  await win.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await win.mouse.down();
  await win.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await whileOver?.();
  await win.mouse.up();
}
