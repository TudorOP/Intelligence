import type { InputHTMLAttributes } from 'react';
export default function Switch(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <input
      {...props}
      type="checkbox"
      role="switch"
      className={'toggle-switch ' + (props.className ?? '')}
    />
  );
}
