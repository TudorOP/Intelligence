import { useEffect, useRef } from 'react';
import { t } from './i18n';
export default function Splitter({
  name,
  value,
  min = 180,
  max = 650,
  reverse = false,
  onSave,
}: {
  name: string;
  value: number;
  min?: number;
  max?: number;
  reverse?: boolean;
  onSave: (v: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null),
    width = useRef(value),
    frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <div
      className="pane-splitter"
      role="separator"
      tabIndex={0}
      aria-label={t(name)}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, width: value };
        width.current = value;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        width.current = Math.max(
          min,
          Math.min(max, start.current.width + (e.clientX - start.current.x) * (reverse ? -1 : 1)),
        );
        const parent = e.currentTarget.parentElement;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() =>
          parent?.style.setProperty('--pane-width', width.current + 'px'),
        );
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        cancelAnimationFrame(frame.current);
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onSave(width.current);
      }}
      onPointerCancel={() => {
        start.current = null;
        cancelAnimationFrame(frame.current);
        onSave(value);
      }}
      onKeyDown={(e) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          onSave(
            e.key === 'Home'
              ? min
              : e.key === 'End'
                ? max
                : Math.max(
                    min,
                    Math.min(max, value + (e.key === 'ArrowRight' ? 20 : -20) * (reverse ? -1 : 1)),
                  ),
          );
        }
      }}
    />
  );
}
