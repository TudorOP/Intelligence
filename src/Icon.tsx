import type { CSSProperties } from 'react';
export default function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={'symbol-icon ' + className}
      style={
        {
          '--icon': `url("${new URL('./assets/icons/' + name + '.svg', window.location.href).href}")`,
        } as CSSProperties
      }
    />
  );
}
