/**
 * `use:trapFocus` — keep keyboard focus inside a modal while it's mounted
 * (#1104). The app's dialogs render as `<div role="dialog" aria-modal="true">`
 * overlays, which announce modality to assistive tech but do NOT actually trap
 * the browser's Tab focus (only a native `<dialog>.showModal()` or JS does). So
 * without this, Tab from the last control escapes to the app behind the overlay
 * — a keyboard-first tool's worst a11y failure mode.
 *
 * Behaviour:
 *   - On mount, pulls focus into the dialog if it isn't already there (a no-op
 *     when the dialog already autofocuses a field).
 *   - Intercepts Tab / Shift+Tab only at the ends, wrapping first↔last, so
 *     native Tab still moves between controls in between.
 *   - On destroy, restores focus to whatever held it before the dialog opened.
 *
 * Do NOT apply to a dialog that gives Tab a non-navigation meaning (e.g.
 * PromptDialog's Tab-to-accept-suggestion) — the trap would swallow it.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function trapFocus(node: HTMLElement): { destroy(): void } {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const getFocusable = (): HTMLElement[] =>
    // Post-filter tabindex="-1": `button:not([disabled])` etc. still match an
    // element the author explicitly pulled out of the tab order.
    Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((el) => el.getAttribute('tabindex') !== '-1');

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const items = getFocusable();
    if (items.length === 0) {
      // Nothing to focus — keep Tab from leaking to the background anyway.
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    const outside = !node.contains(active);
    if (e.shiftKey) {
      if (outside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (outside || active === last) {
      e.preventDefault();
      first.focus();
    }
    // Otherwise let the browser advance focus natively within the dialog.
  }

  if (!node.contains(document.activeElement)) getFocusable()[0]?.focus();
  node.addEventListener('keydown', onKeydown);

  return {
    destroy() {
      node.removeEventListener('keydown', onKeydown);
      previouslyFocused?.focus?.();
    },
  };
}
