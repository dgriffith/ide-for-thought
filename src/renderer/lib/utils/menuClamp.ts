/**
 * Keep floating context menus inside the viewport.
 *
 * The Electron title-bar menus are native and the OS handles edge
 * avoidance. Our in-app menus (sidebar file tree, tab right-click,
 * tables, bookmarks, editor content + gutter) are custom HTML divs —
 * so clicking near any window edge will run them off-screen unless we
 * nudge them back.
 *
 * Two helpers:
 *   - `clampMenuToViewport(x, y, el)` for the top-level menu opened at
 *     pointer coordinates. Caller drives it from a $effect that
 *     measures the rendered menu and pushes back the originating
 *     coordinates if any edge overflows.
 *   - `clampSubmenu(itemEl)` for hover-opened submenus. Submenus
 *     default to opening down + right of the parent item; this flips
 *     them up / left when they'd overflow, and falls back to clamping
 *     to the viewport edge if a flip would clip the opposite edge too.
 *
 * Usage:
 *   $effect(() => {
 *     if (!contextMenu || !menuEl) return;
 *     const next = clampMenuToViewport(contextMenu.x, contextMenu.y, menuEl);
 *     if (next.x !== contextMenu.x || next.y !== contextMenu.y) {
 *       contextMenu = { ...contextMenu, ...next };
 *     }
 *   });
 *
 *   <div class="submenu-item" onmouseenter={(e) => clampSubmenu(e.currentTarget)}>
 */
const MARGIN = 8;

export function clampMenuToViewport(
  x: number,
  y: number,
  el: HTMLElement,
): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  let nextX = x;
  let nextY = y;
  if (rect.bottom > vh - MARGIN) {
    nextY = Math.max(MARGIN, vh - rect.height - MARGIN);
  }
  if (rect.right > vw - MARGIN) {
    nextX = Math.max(MARGIN, vw - rect.width - MARGIN);
  }
  // Top / left clamps run after the bottom / right ones so a tall menu
  // anchored to a low click pins to the top edge rather than the
  // bottom — the user is much more likely to want the first items
  // visible than the last.
  if (rect.top < MARGIN) {
    nextY = MARGIN;
  }
  if (rect.left < MARGIN) {
    nextX = MARGIN;
  }
  return { x: nextX, y: nextY };
}

/**
 * Reposition a hover-opened `.submenu` inside the given `.submenu-item`
 * so it stays in the viewport. Resets prior overrides first so the
 * default CSS position (right + below the parent) is measured cleanly,
 * then flips / clamps as needed. The submenu is `position: absolute`
 * inside the item — `top` / `bottom` styles are interpreted relative
 * to the item, so we convert viewport-target positions to item-local
 * offsets where needed.
 */
export function clampSubmenu(item: HTMLElement): void {
  const submenu = item.querySelector<HTMLElement>(':scope > .submenu');
  if (!submenu) return;

  submenu.style.top = '';
  submenu.style.bottom = '';
  submenu.style.left = '';
  submenu.style.right = '';

  requestAnimationFrame(() => {
    const subRect = submenu.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // Vertical: prefer down (default), else flip up, else clamp to top
    // edge. The flipped position has the submenu's bottom 4px below the
    // item's bottom — its top would be at `itemRect.bottom + 4 - height`.
    if (subRect.bottom > vh - MARGIN) {
      const flippedTop = itemRect.bottom + 4 - subRect.height;
      if (flippedTop >= MARGIN) {
        submenu.style.top = 'auto';
        submenu.style.bottom = '-4px';
      } else {
        // Neither down nor up fits cleanly — pin the submenu top to
        // MARGIN so the first items are visible. CSS `top` is relative
        // to the item, so this offsets it to land at viewport MARGIN.
        submenu.style.top = `${MARGIN - itemRect.top}px`;
        submenu.style.bottom = 'auto';
      }
    } else if (subRect.top < MARGIN) {
      // Default-down position already clips the top — happens when the
      // parent item sits near the top of the viewport.
      submenu.style.top = `${MARGIN - itemRect.top}px`;
      submenu.style.bottom = 'auto';
    }

    if (subRect.right > vw - MARGIN) {
      submenu.style.left = 'auto';
      submenu.style.right = '100%';
    }
  });
}
