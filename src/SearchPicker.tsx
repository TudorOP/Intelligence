import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from './i18n';
import Icon from './Icon';

export type PickerOption = {
  value: string;
  label: string;
  group?: string;
  detail?: string;
  disabled?: boolean;
  image?: string;
};
export default function SearchPicker({
  label,
  value,
  options,
  onChange,
  compact = false,
  disabled = false,
  placeholder,
  footer,
  status,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  compact?: boolean;
  disabled?: boolean;
  placeholder?: string;
  footer?: { label: string; action: () => void };
  status?: string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 400, width: 340 });
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const id = useId(),
    selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) =>
    `${o.label} ${o.group || ''} ${o.detail || ''}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current!.getBoundingClientRect(),
        width = Math.min(380, innerWidth - 16);
      const above = innerHeight - r.bottom < 320 && r.top > innerHeight - r.bottom;
      const maxHeight = Math.min(440, Math.max(0, (above ? r.top : innerHeight - r.bottom) - 16));
      const height = Math.min(panel.current?.scrollHeight || 400, maxHeight);
      setPosition({
        left: Math.max(8, Math.min(r.left, innerWidth - width - 8)),
        top: above ? Math.max(8, r.top - height - 6) : r.bottom + 6,
        maxHeight,
        width,
      });
    };
    place();
    input.current?.focus();
    const resize = new ResizeObserver(place);
    if (panel.current) resize.observe(panel.current);
    window.addEventListener('resize', place);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !panel.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        close(false);
    };
    const scroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  return (
    <>
      <button
        type="button"
        className={'search-picker-trigger' + (compact ? ' icon-button' : '')}
        ref={trigger}
        disabled={disabled}
        aria-label={label}
        data-tooltip={`${label}: ${selected ? [selected.group, selected.label, selected.detail].filter(Boolean).join(' · ') : placeholder || t('Choose a model')}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setQuery('');
          setOpen((v) => !v);
        }}
      >
        {compact ? (
          <Icon name="brain" />
        ) : (
          <>
            <span>{selected?.label || placeholder || label}</span>
            <span aria-hidden="true">⌄</span>
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={panel}
            className="search-picker-panel"
            role="dialog"
            aria-label={label}
            style={position}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
              if (
                ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) &&
                (!(e.target instanceof HTMLInputElement) ||
                  ['ArrowDown', 'ArrowUp'].includes(e.key))
              ) {
                const buttons = Array.from(
                  panel.current!.querySelectorAll<HTMLButtonElement>(
                    '.picker-option:not(:disabled)',
                  ),
                );
                if (!buttons.length) return;
                e.preventDefault();
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  buttons[
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? buttons.length - 1
                        : index < 0
                          ? e.key === 'ArrowUp'
                            ? buttons.length - 1
                            : 0
                          : (index + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) %
                            buttons.length
                  ];
                next?.focus({ preventScroll: true });
                next?.scrollIntoView({ block: 'nearest' });
              }
            }}
          >
            <strong>{label}</strong>
            {selected && (
              <small className="picker-current">
                {[selected.group, selected.label].filter(Boolean).join(' · ')}
              </small>
            )}
            <input
              ref={input}
              aria-label={t('Search choices')}
              placeholder={t('Search…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="picker-options">
              {filtered.slice(0, 300).map((o, i) => (
                <div key={o.value}>
                  {o.group && o.group !== filtered[i - 1]?.group && (
                    <div className="picker-group">{o.group}</div>
                  )}
                  <button
                    className="picker-option"
                    data-value={o.value}
                    type="button"
                    disabled={o.disabled}
                    aria-pressed={value === o.value}
                    onClick={() => {
                      onChange(o.value);
                      close();
                    }}
                  >
                    {o.image && <img src={o.image} alt="" />}
                    <span>
                      {o.label}
                      {o.detail && <small>{o.detail}</small>}
                    </span>
                    <span aria-hidden="true">{value === o.value ? '✓' : ''}</span>
                  </button>
                </div>
              ))}
            </div>
            {!filtered.length && <p>{t('No matching choices')}</p>}
            {filtered.length > 300 && (
              <small>{t('Showing up to 300 items. Refine the search to find more.')}</small>
            )}
            {status && <small role="status">{status}</small>}
            {footer && (
              <button
                className="picker-footer"
                type="button"
                onClick={() => {
                  close();
                  footer.action();
                }}
              >
                {footer.label} ↗
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
