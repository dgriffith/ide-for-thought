/**
 * Install a one-shot "dismiss this menu on the next outside click" listener —
 * the idiom every context / overflow menu in the app shares (#989).
 *
 * Registration is deferred to the next tick (`setTimeout(…, 0)`) so the very
 * click that opened the menu doesn't immediately dismiss it. The listener
 * removes itself once it fires.
 *
 * @param onDismiss       Runs when an outside click lands — set the menu state
 *                        to `null`/`false` here.
 * @param ignoreSelector  When provided, a click whose target is inside a
 *                        matching element is ignored: the menu stays open and
 *                        the listener stays armed. Used for menus with
 *                        interactive contents (e.g. submenus, copy-as pickers).
 */
export function installDismissOnClickOutside(
  onDismiss: () => void,
  ignoreSelector?: string,
): void {
  const close = (ev: MouseEvent) => {
    if (ignoreSelector) {
      const target = ev.target as HTMLElement | null;
      if (target?.closest(ignoreSelector)) return;
    }
    onDismiss();
    window.removeEventListener('click', close);
  };
  setTimeout(() => window.addEventListener('click', close), 0);
}
