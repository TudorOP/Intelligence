import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from './i18n';
export default function ActionMenu({
  children,
  label = t('More options'),
  hiddenTrigger = false,
  symbol = '···',
  className = '',
}: {
  children: ReactNode;
  label?: string;
  hiddenTrigger?: boolean;
  symbol?: string;
  className?: string;
}) {
  const trigger = useRef<HTMLDetailsElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = () => {
    setAnchor(null);
    trigger.current?.removeAttribute('open');
  };
  const show = (x?: number, y?: number) => {
    const r = trigger.current!.getBoundingClientRect();
    setAnchor({ x: x ?? r.left, y: y ?? r.bottom + 6 });
  };
  useLayoutEffect(() => {
    if (!anchor || !panel.current) return;
    const p = panel.current,
      r = p.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(anchor.x, innerWidth - r.width - 8)) + 'px';
    p.style.top = Math.max(40, Math.min(anchor.y, innerHeight - r.height - 8)) + 'px';
    p.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const observer = new ResizeObserver(() => {
      const rect = p.getBoundingClientRect();
      p.style.left = Math.max(8, Math.min(anchor.x, innerWidth - rect.width - 8)) + 'px';
      p.style.top = Math.max(40, Math.min(anchor.y, innerHeight - rect.height - 8)) + 'px';
    });
    observer.observe(p);
    return () => observer.disconnect();
  }, [anchor]);
  useEffect(() => {
    const owner =
      trigger.current?.closest<HTMLElement>(
        '.resource-card,.book-notebook,.task-card-shell,.task-card,.card-detail,.kanban-list,.tasks-page,.vault-tree-row,.recent-row,.note-area,.notebook-overview,.matrix-task',
      ) ?? trigger.current?.parentElement;
    const context = (event: MouseEvent) => {
      if ((event.target as Element).closest('input,textarea,[contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      show(event.clientX, event.clientY);
    };
    owner?.addEventListener('contextmenu', context);
    return () => owner?.removeEventListener('contextmenu', context);
  }, []);
  useEffect(() => {
    if (!anchor) return;
    const outside = (e: PointerEvent) => {
      if (
        !panel.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        trigger.current?.querySelector('summary')?.focus();
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const buttons = Array.from(
          panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
        );
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? buttons.length - 1
              : (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        ]?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    const scroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [anchor]);
  return (
    <details
      ref={trigger}
      className={'dropdown' + (hiddenTrigger ? ' context-only' : '')}
      open={!!anchor}
    >
      <summary
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          anchor ? close() : show();
        }}
      >
        {symbol}
      </summary>
      {anchor
        ? createPortal(
            <div
              ref={panel}
              className={'dropdown-content floating-actions ' + className}
              aria-label={label}
              style={{ left: anchor.x, top: anchor.y }}
              onClick={(e) => {
                if ((e.target as Element).closest('button')) close();
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </details>
  );
}
