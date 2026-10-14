import type { CSSProperties } from 'react';
import { t } from './i18n';
export default function ContextMeter({ info }: { info: any }) {
  const percent = Math.round((info.used / Math.max(1, info.capacity)) * 100);
  const details = `${t('Context')}: ${info.estimated ? '~' : ''}${info.used.toLocaleString()} / ${info.capacity.toLocaleString()} ${t('tokens')} (${percent}%). ${t('The filled slice shows how much of the model context is in use.')}${info.capacitySource?.startsWith('fallback') ? ' ' + t('The model capacity could not be detected. Set it in Chat & context if needed.') : ''}`;
  return (
    <span className="context-meter" tabIndex={0} aria-label={details} data-tooltip={details}>
      <span
        className="context-pie"
        aria-hidden="true"
        style={
          { '--context-angle': Math.min(100, Math.max(0, percent)) * 3.6 + 'deg' } as CSSProperties
        }
      />
      <span>
        {info.estimated ? '~' : ''}
        {percent}%
      </span>
    </span>
  );
}
