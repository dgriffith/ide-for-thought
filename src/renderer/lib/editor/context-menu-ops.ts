// Types for the editor context menu (#1625). The menu was extracted out of
// Editor.svelte into EditorContextMenu.svelte; these types are the contract
// between the two, plus the single grouped ops object that replaced ~20
// one-shot forwarder props on Editor.

import type { LinkRange } from './link-decorations';
import type { ThinkingToolInfo } from '../../../shared/tools/types';
import type { ToolGroup } from '../../../shared/tools/grouping';

/** Live state of the open context menu: where it sits and what the
 *  right-click landed on. `null` when the menu is closed. */
export interface EditorContextMenuState {
  x: number;
  y: number;
  /** The wiki/URL link under the cursor, if the click was on one. */
  link: LinkRange | null;
  hasSelection: boolean;
  /** Document offset of the click — used to anchor a `^block-id`. */
  docPos: number | null;
  /** A `thought:Claim` URI resolved from the selection/line, gating the
   *  argument-mining tools. */
  claimUri: string | null;
}

/**
 * The host-side actions the context menu fans out to, grouped into one object
 * so Editor takes a single `menuOps` prop instead of ~20 `on*` callbacks. Every
 * entry is optional: the menu renders an item only when its op is supplied
 * (same `{#if onX}` guarding the individual props had). The wiring lives in the
 * App ops clusters; Editor just forwards this straight to EditorContextMenu.
 */
export interface EditorMenuOps {
  openConversation?: () => void;
  bookmark?: () => void;
  bookmarkSection?: () => void;
  bookmarkLine?: () => void;
  insertQueryList?: () => void;
  extractSelection?: () => void;
  splitHere?: () => void;
  splitByHeading?: () => void;
  rename?: () => void;
  move?: () => void;
  copyFile?: () => void;
  merge?: () => void;
  autoTag?: () => void;
  autoLink?: () => void;
  autoLinkInbound?: () => void;
  formatCurrentNote?: () => void;
  addTagCurrentNote?: () => void;
  removeTagCurrentNote?: () => void;
  addPropertyCurrentNote?: () => void;
  removePropertyCurrentNote?: () => void;
  invokeTool?: (toolId: string) => void;
}

/** One Tools-for-Thought submenu (Learning / Research / Analysis), built to
 *  mirror the native menu. Matches the shape Editor derives from the registry. */
export interface EditorToolMenu {
  id: 'learning' | 'research' | 'analysis';
  label: string;
  tools: ThinkingToolInfo[];
  groups: ToolGroup<ThinkingToolInfo>[];
}
