/**
 * What a mindmap asks its host to do when it can be edited (#2965). The host
 * owns the data — for a note's outline, the note's text — and makes each
 * edit; the map only asks, and follows the node by the id the host returns
 * (an edit can change a node's id: a note's nodes are named by their path).
 */
export interface MindmapEdits {
  /** A new node arrives named (a note asked its title when it was made): the map doesn't name it in place. */
  namesItself?: boolean;
  /** Add an empty last child; the new node's id, to name it in place. */
  addChild(id: string): Promise<string | null> | string | null;
  /** Add an empty sibling right after it. */
  addSibling(id: string): Promise<string | null> | string | null;
  /** The node's id afterwards. */
  rename(id: string, text: string): Promise<string | null> | string | null;
  /** Remove it and everything beneath it; true when it went (the host may ask first, unless `confirmed`). */
  remove(id: string, opts?: { confirmed?: boolean }): Promise<boolean> | boolean;
  /** Move it before or after another node, or in as its last child; its id afterwards. */
  drop(id: string, target: string, where: 'before' | 'after' | 'child'): Promise<string | null> | string | null;
  /** Out a level, or in under the sibling before; its id afterwards. */
  promote(id: string): Promise<string | null> | string | null;
  demote(id: string): Promise<string | null> | string | null;
  undo(): void;
  redo(): void;
}
