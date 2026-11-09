/**
 * A map's pins from the keyboard (#2934), out of `TypeViewMap.svelte`: one
 * roving tab stop (the last pin focused, else the first in view, else the
 * first), the arrows stepping in `pin-order.ts`'s fixed order, Enter to open,
 * Shift+F10 / the menu key for the note menu, Space to toggle the pin in the
 * view's selection (#2939), and Escape to close the preview, then go back to
 * the map. The keys a pin takes stop there, so MapLibre's handler (on the
 * canvas container) doesn't pan as well.
 */
import type * as maplibregl from 'maplibre-gl';
import { isMenuKey, openMenuAt } from '../components/type-view/note-actions';
import { eastwardOrder, nextPin, type PinPoint } from './pin-order';

interface HoverSubject {
  key: string;
  target: string;
  anchor: Element;
  fallbackTitle: string;
}

export interface PinKeyboardHost {
  map: () => maplibregl.Map | null;
  pins: () => readonly PinPoint[];
  elements: () => ReadonlyMap<string, HTMLElement>;
  hover: { focus(subject: HoverSubject): void; close(): void };
  onOpen: (path: string) => void;
  /** Space: the pin in or out of the view's selection (#2939); absent where the view doesn't select. */
  onToggle?: (() => ((path: string) => void) | undefined) | undefined;
}

export function createPinKeyboard(host: PinKeyboardHost) {
  /** The pin focus was last on — the pins' tab stop while it's still drawn. */
  let focusedPin: string | null = null;
  /** An Escape has closed the focused pin's preview: the next goes back to the map. (The
   *  preview closes itself on Escape before the pin hears it, so the hover can't say.) */
  let previewDismissed = false;

  function tabStop(): string | null {
    const pins = host.pins();
    if (pins.length === 0) return null; // an export, or nothing to focus
    if (focusedPin && host.elements().has(focusedPin)) return focusedPin;
    const order = eastwardOrder(pins);
    const view = host.map()?.getBounds();
    const inView = view ? order.find((path) => { const p = pins.find((x) => x.path === path)!; return view.contains([p.lng, p.lat]); }) : undefined;
    return inView ?? order[0] ?? null;
  }

  function updateTabStop(): void {
    const stop = tabStop();
    for (const [path, pin] of host.elements()) pin.tabIndex = path === stop ? 0 : -1;
  }

  function onFocus(path: string, lngLat: [number, number], subject: HoverSubject): void {
    focusedPin = path;
    previewDismissed = false;
    updateTabStop();
    host.hover.focus(subject);
    // Out of view: bring it in, at the same zoom.
    const map = host.map();
    if (map && !map.getBounds().contains(lngLat)) map.easeTo({ center: lngLat });
  }

  function onKeydown(e: KeyboardEvent, path: string, pin: HTMLElement): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    let handled = true;
    const toggle = host.onToggle?.();
    if (isMenuKey(e)) openMenuAt(pin); // the pin's own contextmenu listener opens the note menu
    else if (e.key === 'Enter') host.onOpen(path);
    else if (e.key === ' ' && toggle && !e.shiftKey) toggle(path);
    else if (e.key === 'Escape') {
      if (previewDismissed) host.map()?.getCanvas().focus();
      else { previewDismissed = true; host.hover.close(); }
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && !e.shiftKey) {
      const next = nextPin(host.pins(), path, e.key);
      if (next) host.elements().get(next)?.focus();
    } else handled = false;
    if (!handled) return;
    e.preventDefault();
    // MapLibre's keyboard handler is on the canvas container: it mustn't pan as well. Escape
    // isn't one of its keys, and goes on to the view, where it clears the selection (#2939).
    if (e.key !== 'Escape') e.stopPropagation();
  }

  return { updateTabStop, onFocus, onKeydown };
}
