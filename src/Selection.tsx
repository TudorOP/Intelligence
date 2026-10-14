import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Background dragging selects; item dragging remains available for moving/reordering.
export function useMarqueeSelection(
  selector: string,
  selected: Set<string>,
  onSelect: (ids: Set<string>) => void,
  anchor?: React.RefObject<string | null>,
) {
  const latest = useRef({ selected, onSelect });
  latest.current = { selected, onSelect };
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    let cleanupDrag: (() => void) | undefined;
    const start = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      const surface = target.closest<HTMLElement>('[data-selection-surface]');
      if (
        !surface ||
        !surface.matches(selector) ||
        event.button !== 0 ||
        target.closest(
          '[data-selection-id],button,input,select,textarea,a,summary,[contenteditable],.dropdown,.pane-splitter',
        )
      )
        return;
      const items = [...surface.querySelectorAll<HTMLElement>('[data-selection-id]')].filter(
        (e) => e.getClientRects().length && e.closest('[data-selection-surface]') === surface,
      );
      if (!items.length) return;
      event.preventDefault();
      const x = event.clientX,
        y = event.clientY;
      const base =
        event.ctrlKey || event.metaKey || event.shiftKey
          ? new Set(latest.current.selected)
          : new Set<string>();
      let moved = false;
      const move = (e: PointerEvent) => {
        if (Math.hypot(e.clientX - x, e.clientY - y) < 5 && !moved) return;
        moved = true;
        const r = {
          left: Math.min(x, e.clientX),
          top: Math.min(y, e.clientY),
          width: Math.abs(e.clientX - x),
          height: Math.abs(e.clientY - y),
        };
        const bounds = surface.getBoundingClientRect();
        const ids = new Set(base);
        for (const item of items) {
          const a = (
            item.matches('details') ? item.querySelector('summary') || item : item
          ).getBoundingClientRect();
          if (
            a.right > bounds.left &&
            a.left < bounds.right &&
            a.bottom > bounds.top &&
            a.top < bounds.bottom &&
            a.right > r.left &&
            a.left < r.left + r.width &&
            a.bottom > r.top &&
            a.top < r.top + r.height
          )
            ids.add(item.dataset.selectionId!);
        }
        latest.current.onSelect(ids);
        if (anchor && ids.size) anchor.current = [...ids].at(-1)!;
        setBox(r);
      };
      const end = (e: PointerEvent) => {
        if (e.type === 'pointerup' && !moved) latest.current.onSelect(base);
        cleanupDrag?.();
      };
      cleanupDrag?.();
      cleanupDrag = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('blur', cancel);
        setBox(null);
        cleanupDrag = undefined;
      };
      const cancel = () => cleanupDrag?.();
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      window.addEventListener('blur', cancel);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !latest.current.selected.size) return;
      const active = document.activeElement;
      if (active?.closest('input,textarea,[contenteditable],.dropdown')) return;
      // Do not clear an unrelated page's selection while a dialog is open.
      const dialog = document.querySelector('[data-dialog-panel]');
      if (dialog && !dialog.querySelector(selector)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      latest.current.onSelect(new Set());
      if (anchor) anchor.current = null;
      cleanupDrag?.();
    };
    document.addEventListener('pointerdown', start);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', start);
      document.removeEventListener('keydown', key, true);
      cleanupDrag?.();
    };
  }, [selector, anchor]);
  return box
    ? createPortal(
        <div className="selection-marquee" aria-hidden="true" style={box} />,
        document.body,
      )
    : null;
}
