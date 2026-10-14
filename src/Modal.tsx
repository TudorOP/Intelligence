import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from './i18n';
let openCount = 0,
  oldOverflow = '';
export default function Modal({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement,
      root = document.getElementById('root');
    if (!openCount++) {
      oldOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      root?.setAttribute('inert', '');
    }
    const panel = ref.current;
    panel?.querySelector<HTMLElement>('button,input,select,textarea,[tabindex="0"]')?.focus();
    const key = (e: KeyboardEvent) => {
      if (
        document.querySelectorAll('[data-dialog-panel]')[
          document.querySelectorAll('[data-dialog-panel]').length - 1
        ] !== panel
      )
        return;
      if (e.key === 'Escape') {
        if (panel?.querySelector('[data-selection-id][data-selected="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === 'Tab' && panel) {
        const nodes = [
            ...panel.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
            ),
          ].filter((n) => n.offsetParent !== null),
          first = nodes[0],
          last = nodes.at(-1);
        if (!first) {
          e.preventDefault();
          panel.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      if (!--openCount) {
        document.body.style.overflow = oldOverflow;
        root?.removeAttribute('inert');
      }
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return createPortal(
    <div className="modal-backdrop next-modal-backdrop">
      <section
        ref={ref}
        data-dialog-panel
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={'next-modal ' + className}
      >
        <header>
          <h2>{title}</h2>
          <button aria-label={t('Close')} onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
